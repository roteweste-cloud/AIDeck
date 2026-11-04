import asyncio
import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
HOME = "https://chatgpt.com/"
CHAT_PATH = re.compile(r"/c/[a-zA-Z0-9-]+")
SELECTORS = json.loads((ROOT / "selectors.json").read_text(encoding="utf-8"))
SCRIPT = (ROOT / "driver.js").read_text(encoding="utf-8")


def chat_url(value):
    return (isinstance(value, str) and value.startswith(HOME)
            and CHAT_PATH.fullmatch(value.removeprefix(HOME[:-1])) is not None)


async def page(cdp, action="state", image=None, path=None):
    arguments = json.dumps([SELECTORS, action, image, path])
    return await cdp.evaluate(f"({SCRIPT})(...{arguments})")


async def wait_for(cdp, predicate, seconds, path=None):
    deadline = asyncio.get_running_loop().time() + seconds
    while True:
        state = await page(cdp, path=path)
        if state and predicate(state):
            return state
        if asyncio.get_running_loop().time() >= deadline:
            return None
        await asyncio.sleep(0.25)


async def send(cdp, url, screenshot, prompt, navigate=False):
    path = url.removeprefix(HOME[:-1])
    current = await page(cdp)
    if navigate or (current and current["path"] != path):
        result = await cdp.call("Page.navigate", url=url)
        if result.get("errorText"):
            raise RuntimeError("ChatGPT konnte nicht geöffnet werden.")
    state = await wait_for(cdp, lambda s: s["composer"] or s["login"], 15, path)
    if not state or state["login"]:
        raise RuntimeError("ChatGPT ist noch nicht bereit. Bitte anmelden oder die Prüfung im Browser abschließen.")
    if state["draft"] or state["attachment"]:
        raise RuntimeError("Im Chat liegt ein Entwurf. Bitte zuerst senden oder leeren.")
    if state["busy"]:
        raise RuntimeError("ChatGPT antwortet noch. Bitte danach erneut versuchen.")
    image = base64.b64encode(screenshot.read_bytes()).decode("ascii")
    await page(cdp, "paste", image, path)
    if not await wait_for(cdp, lambda s: s["attachment"], 3, path):
        if not await page(cdp, "focus", path=path):
            raise RuntimeError("ChatGPT-Eingabefeld nicht mehr erreichbar.")
        await cdp.set_file(SELECTORS["file"], screenshot)

    if not await wait_for(cdp, lambda s: s["attachment"], 8, path):
        raise RuntimeError("ChatGPT hat den Screenshot nicht angehängt. Bitte Upload prüfen.")
    if not await page(cdp, "focus", path=path):
        raise RuntimeError("ChatGPT-Eingabefeld nicht mehr erreichbar.")
    await cdp.call("Input.insertText", text=prompt)
    ready = await wait_for(cdp, lambda s: s["attachment"] and s["draft"]
                           and s["enabled"] and not s["busy"], 20, path)
    if not ready:
        raise RuntimeError("Upload oder Senden nicht verfügbar. Bitte ChatGPT auf ein Limit oder einen Fehler prüfen.")
    if not await page(cdp, "send", path=path):
        if not await page(cdp, "focus", path=path):
            raise RuntimeError("ChatGPT-Eingabefeld nicht mehr erreichbar.")
        await cdp.call("Input.dispatchKeyEvent", type="keyDown", key="Enter",
                       code="Enter", windowsVirtualKeyCode=13)
        await cdp.call("Input.dispatchKeyEvent", type="keyUp", key="Enter",
                       code="Enter", windowsVirtualKeyCode=13)
    sent = await wait_for(cdp, lambda s: CHAT_PATH.fullmatch(s["path"])
                          and s["messages"] > ready["messages"], 20)
    if not sent:
        raise RuntimeError("ChatGPT hat das Senden nicht bestätigt. Bitte im Chat prüfen.")
    return HOME[:-1] + sent["path"]
