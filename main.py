import asyncio
import json
import re
import tempfile
from contextlib import AsyncExitStack
from pathlib import Path

import aiohttp
import decky

import web_driver
import screenshot
from grips import watch_grips
from cdp import CDP, find_target, socket_url

BASE = Path(__file__).resolve().parent
LEGACY_PROMPTS = json.loads((BASE / "defaults/prompts.json").read_text(encoding="utf-8"))
PROMPTS = json.loads((BASE / "defaults/prompts.en.json").read_text(encoding="utf-8"))
PROVIDERS = web_driver.PROVIDERS
DARK_MODE = (BASE / "py_modules/dark_mode.js").read_text(encoding="utf-8")
DEFAULTS = {"enabled": True, "buttons": [32, 33], "prompts": PROMPTS, "chats": {}, "provider": "chatgpt"}


class Plugin:
    async def _main(self):
        self.file = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"
        self.file.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.settings = {**DEFAULTS, **json.loads(self.file.read_text(encoding="utf-8"))}
        except (OSError, ValueError, TypeError):
            self.settings = DEFAULTS.copy()
        if self.settings.get("provider") not in PROVIDERS:
            self.settings["provider"] = "chatgpt"
        old_prompts = self.settings.get("prompts", {})
        self.settings["prompts"] = {
            key: default if old_prompts.get(key) in (None, LEGACY_PROMPTS[key]) else old_prompts[key]
            for key, default in PROMPTS.items()
        }
        chats = self.settings.get("chats", {})
        legacy_chats = {key: url for key, url in chats.items()
                        if web_driver.chat_url(PROVIDERS["chatgpt"], url)}
        self.settings["chats"] = {key: value for key, value in chats.items()
                                  if key in PROVIDERS and isinstance(value, dict)}
        if legacy_chats:
            self.settings["chats"]["chatgpt"] = {**legacy_chats, **self.settings["chats"].get("chatgpt", {})}
        self.lock = asyncio.Lock()
        self.target = None
        self.theme_connection = AsyncExitStack()
        self.last_error = ""
        self.temporary = tempfile.TemporaryDirectory(prefix="aideck-")
        self.shot = Path(self.temporary.name) / "shot.png"
        self.grip_task = asyncio.create_task(watch_grips(self.grip_pressed))

    async def grip_pressed(self):
        if self.settings["enabled"] and set(self.settings["buttons"]) == {32, 33}:
            await decky.emit("grip_shortcut")

    async def _unload(self):
        self.grip_task.cancel()
        await asyncio.gather(self.grip_task, return_exceptions=True)
        async with self.lock:
            await self.theme_connection.aclose()
            self.temporary.cleanup()

    def save(self, settings):
        temporary = self.file.with_suffix(".tmp")
        temporary.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.file)
        self.settings = settings

    async def get_settings(self):
        return {k: self.settings[k] for k in ("enabled", "buttons", "prompts", "provider")}

    async def set_settings(self, settings):
        provider = settings["provider"]
        if provider not in PROVIDERS:
            raise ValueError("Unknown AI provider.")
        buttons = settings["buttons"]
        if (not isinstance(buttons, list) or not 2 <= len(buttons) <= 64
                or any(type(b) is not int or not 0 <= b <= 255 for b in buttons)
                or len(set(buttons)) != len(buttons)):
            raise ValueError("Choose at least two different buttons.")
        prompts = settings["prompts"]
        if any(not isinstance(prompts.get(k), str) or not 1 <= len(prompts[k].strip()) <= 6000
               for k in PROMPTS):
            raise ValueError("Prompts must contain between 1 and 6000 characters.")
        self.save({**self.settings, "enabled": bool(settings["enabled"]),
                   "buttons": buttons, "provider": provider, "prompts": {k: prompts[k] for k in PROMPTS}})

    async def register_browser(self, marker):
        if not re.fullmatch(r"[0-9a-f-]{36}", marker):
            raise ValueError("Invalid browser identifier.")
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
        return PROVIDERS[self.settings["provider"]]["home"]

    def url(self, appid, provider_id):
        provider = PROVIDERS[provider_id]
        value = self.settings["chats"].get(provider_id, {}).get(appid)
        return value if web_driver.chat_url(provider, value) else provider["home"]

    async def chat_for_game(self, appid, provider_id):
        return self.url(appid, provider_id)

    async def reset_chat(self, appid, provider_id):
        provider = PROVIDERS[provider_id]
        async with self.lock:
            chats = dict(self.settings["chats"].get(provider_id, {}))
            chats.pop(appid, None)
            self.save({**self.settings, "chats": {**self.settings["chats"], provider_id: chats}})
            return provider["home"]

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

    async def send_to_chat(self, appid, game, provider_id):
        async with self.lock:
            try:
                if not self.shot.is_file():
                    raise RuntimeError("No screenshot is available.")
                provider = PROVIDERS[provider_id]
                url = self.url(appid, provider_id)
                template = "follow" if web_driver.chat_url(provider, url) else "first"
                prompt = self.settings["prompts"][template].replace("{game}", game)
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
                    endpoint = await socket_url(session, self.target)
                    async with session.ws_connect(endpoint) as socket:
                        new_url = await web_driver.send(CDP(socket), provider, url, self.shot, prompt)
                chats = {**self.settings["chats"].get(provider_id, {}), appid: new_url}
                self.save({**self.settings, "chats": {**self.settings["chats"], provider_id: chats}})
                self.last_error = ""
            except Exception as error:
                self.last_error = str(error) or "Timed out sending the screenshot."
                decky.logger.warning("AI Deck: %s", self.last_error)
                raise RuntimeError(self.last_error) from error
            finally:
                self.shot.unlink(missing_ok=True)

    async def browser_action(self, action, provider_id):
        if action not in {"focus", "state"}:
            raise ValueError("Unknown browser action.")
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            endpoint = await socket_url(session, self.target)
            async with session.ws_connect(endpoint) as socket:
                return await web_driver.page(CDP(socket), PROVIDERS[provider_id], action)

    async def status(self):
        ready = None
        provider_id = self.settings["provider"]
        if self.target:
            try:
                state = await self.browser_action("state", provider_id)
                if state:
                    ready = True if state["composer"] else (False if state["login"] else None)
            except Exception:
                pass
        return {"provider": provider_id, "ready": ready, "lastError": self.last_error}
