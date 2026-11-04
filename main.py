import asyncio
import json
import re
import tempfile
from contextlib import AsyncExitStack
from pathlib import Path

import aiohttp
import decky

import chatgpt_driver
import screenshot
from cdp import CDP, find_target, socket_url

BASE = Path(__file__).resolve().parent
PROMPTS = json.loads((BASE / "defaults/prompts.json").read_text(encoding="utf-8"))
DARK_MODE = (BASE / "py_modules/dark_mode.js").read_text(encoding="utf-8")
DEFAULTS = {"enabled": True, "buttons": [32, 33], "prompts": PROMPTS, "chats": {}}


class Plugin:
    async def _main(self):
        self.file = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"
        self.file.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.settings = {**DEFAULTS, **json.loads(self.file.read_text(encoding="utf-8"))}
        except (OSError, ValueError, TypeError):
            self.settings = DEFAULTS.copy()
        self.lock = asyncio.Lock()
        self.target = None
        self.theme_connection = AsyncExitStack()
        self.last_error = ""
        self.temporary = tempfile.TemporaryDirectory(prefix="aideck-")
        self.shot = Path(self.temporary.name) / "shot.png"

    async def _unload(self):
        async with self.lock:
            await self.theme_connection.aclose()
            self.temporary.cleanup()

    def save(self, settings):
        temporary = self.file.with_suffix(".tmp")
        temporary.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.file)
        self.settings = settings

    async def get_settings(self):
        return {k: self.settings[k] for k in ("enabled", "buttons", "prompts")}

    async def set_settings(self, settings):
        buttons = settings["buttons"]
        if (not isinstance(buttons, list) or not 2 <= len(buttons) <= 64
                or any(type(b) is not int or not 0 <= b <= 255 for b in buttons)
                or len(set(buttons)) != len(buttons)):
            raise ValueError("Bitte mindestens zwei verschiedene Tasten wählen.")
        prompts = settings["prompts"]
        if any(not isinstance(prompts.get(k), str) or not 1 <= len(prompts[k].strip()) <= 6000
               for k in PROMPTS):
            raise ValueError("Prompt darf nicht leer oder länger als 6000 Zeichen sein.")
        self.save({**self.settings, "enabled": bool(settings["enabled"]),
                   "buttons": buttons, "prompts": {k: prompts[k] for k in PROMPTS}})

    async def register_browser(self, marker):
        if not re.fullmatch(r"[0-9a-f-]{36}", marker):
            raise ValueError("Ungültige Browser-Kennung.")
        self.target = await find_target(marker)
        await self.theme_connection.aclose()
        # Keep the debugger session attached so the script runs on every navigation.
        async with AsyncExitStack() as connection:
            session = await connection.enter_async_context(
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)))
            endpoint = await socket_url(session, self.target)
            socket = await connection.enter_async_context(session.ws_connect(endpoint))
            cdp = CDP(socket)
            await cdp.call("Page.addScriptToEvaluateOnNewDocument", source=DARK_MODE)
            try:
                await cdp.call("Emulation.setEmulatedMedia",
                               features=[{"name": "prefers-color-scheme", "value": "dark"}])
            except RuntimeError as error:
                decky.logger.warning("AI Deck: %s", error)
            self.theme_connection = connection.pop_all()

    def url(self, appid):
        value = self.settings["chats"].get(appid)
        return value if chatgpt_driver.chat_url(value) else chatgpt_driver.HOME

    async def chat_for_game(self, appid):
        return self.url(appid)

    async def reset_chat(self, appid):
        async with self.lock:
            chats = dict(self.settings["chats"])
            chats.pop(appid, None)
            self.save({**self.settings, "chats": chats})

    async def capture(self):
        async with self.lock:
            self.shot.unlink(missing_ok=True)
            try:
                await screenshot.capture(self.shot)
                self.last_error = ""
            except Exception as error:
                self.last_error = str(error)
                raise

    async def discard(self):
        async with self.lock:
            self.shot.unlink(missing_ok=True)

    async def send_to_chat(self, appid, game, fresh=False):
        async with self.lock:
            try:
                if not self.shot.is_file():
                    raise RuntimeError("Kein Screenshot vorhanden.")
                url = self.url(appid)
                template = "follow" if chatgpt_driver.chat_url(url) else "first"
                prompt = self.settings["prompts"][template].replace("{game}", game)
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
                    endpoint = await socket_url(session, self.target)
                    async with session.ws_connect(endpoint) as socket:
                        new_url = await chatgpt_driver.send(CDP(socket), url, self.shot, prompt, fresh)
                self.save({**self.settings, "chats": {**self.settings["chats"], appid: new_url}})
                self.last_error = ""
            except Exception as error:
                self.last_error = str(error) or "Zeitüberschreitung beim Senden."
                decky.logger.warning("AI Deck: %s", self.last_error)
                raise RuntimeError(self.last_error) from error
            finally:
                self.shot.unlink(missing_ok=True)

    async def browser_action(self, action):
        if action not in {"focus", "state"}:
            raise ValueError("Unbekannte Browseraktion.")
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            endpoint = await socket_url(session, self.target)
            async with session.ws_connect(endpoint) as socket:
                return await chatgpt_driver.page(CDP(socket), action)

    async def status(self):
        signed_in = None
        if self.target:
            try:
                state = await self.browser_action("state")
                if state:
                    signed_in = False if state["login"] else (True if state["composer"] else None)
            except Exception:
                pass
        return {"signedIn": signed_in, "lastError": self.last_error}
