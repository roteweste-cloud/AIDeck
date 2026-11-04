import asyncio
import base64
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).parent
PROVIDERS = json.loads((ROOT / "selectors.json").read_text(encoding="utf-8"))
SCRIPT = (ROOT / "driver.js").read_text(encoding="utf-8")


def origin(url):
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def chat_url(provider, value):
    if not isinstance(value, str) or not value.startswith(origin(provider["home"]) + "/"):
        return False
    parts = urlsplit(value)
    return not (parts.query or parts.fragment) and bool(re.fullmatch(provider["path"], parts.path))


async def page(cdp, provider, action="state", image=None, path=None):
    arguments = json.dumps([origin(provider["home"]), provider["selectors"], action, image, path])
    return await cdp.evaluate(f"({SCRIPT})(...{arguments})")


async def wait_for(cdp, provider, predicate, seconds, path=None):
    deadline = asyncio.get_running_loop().time() + seconds
    while True:
        state = await page(cdp, provider, path=path)
        if state and predicate(state):
            return state
        if asyncio.get_running_loop().time() >= deadline:
            return None
        await asyncio.sleep(0.25)


def new_chat_path(provider, path):
    home = urlsplit(provider["home"]).path.rstrip("/") or "/"
    return path == home or bool(re.fullmatch(provider.get("new_path", "(?!)"), path))


async def send(cdp, provider, url, screenshot, prompt):
    path = urlsplit(url).path.rstrip("/") or "/"
    current = await page(cdp, provider)
    is_new = url == provider["home"]
    if not current or not (current["path"] == path or (is_new and new_chat_path(provider, current["path"]))):
        result = await cdp.call("Page.navigate", url=url)
        if result.get("errorText"):
            raise RuntimeError("Could not open the selected provider.")
    state = await wait_for(cdp, provider,
                           lambda s: s["login"] or (
                               (s["path"] == path or (is_new and new_chat_path(provider, s["path"])))
                               and s["composer"]), 20)
    if not state or state["login"]:
        raise RuntimeError("Screenshot captured but not sent. Sign in or complete the browser check, then choose X · Send screenshot.")
    path = state["path"]
    if state["draft"] or state["attachment"]:
        raise RuntimeError("The chat has a draft. Send or clear it first.")
    if state["busy"]:
        raise RuntimeError("The provider is still responding. Try again when it finishes.")
    image = base64.b64encode(screenshot.read_bytes()).decode("ascii")
    await page(cdp, provider, "paste", image, path)
    if not await wait_for(cdp, provider, lambda s: s["attachment"], 3, path):
        if not await page(cdp, provider, "focus", path=path):
            raise RuntimeError("The chat composer is no longer available.")
        await cdp.set_file(provider["selectors"]["file"], screenshot, origin(provider["home"]) + path)

    if not await wait_for(cdp, provider, lambda s: s["attachment"], 10, path):
        raise RuntimeError("Could not confirm the screenshot attachment. Check the upload in the overlay.")
    if not await page(cdp, provider, "focus", path=path):
        raise RuntimeError("The chat composer is no longer available.")
    await cdp.call("Input.insertText", text=prompt)
    ready = await wait_for(cdp, provider, lambda s: s["attachment"] and s["draft"]
                           and s["enabled"] and not s["busy"], 20, path)
    if not ready or not await page(cdp, provider, "send", path=path):
        raise RuntimeError("Could not send the draft automatically. Check it and send it in the overlay.")

    def confirmed(state):
        current_url = origin(provider["home"]) + state["path"]
        return (chat_url(provider, current_url) and (url == provider["home"] or current_url == url)
                and (state["messages"] > ready["messages"] or
                     (state["composer"] and not state["draft"] and not state["attachment"])))

    sent = await wait_for(cdp, provider, confirmed, 25)
    if not sent:
        raise RuntimeError("Could not confirm the sent message and chat link. Check the overlay before retrying.")
    return origin(provider["home"]) + sent["path"]
