import asyncio
import json
from urllib.parse import urlsplit

import aiohttp

DEBUGGER = "http://127.0.0.1:8080"


async def targets(session):
    try:
        async with session.get(f"{DEBUGGER}/json", allow_redirects=False) as response:
            response.raise_for_status()
            return await response.json(content_type=None)
    except (aiohttp.ClientError, TimeoutError) as error:
        raise RuntimeError("Steam CEF debugger is unavailable on port 8080.") from error


async def find_target(marker):
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=3)) as session:
        for _ in range(25):
            for target in await targets(session):
                if target.get("url") == f"data:text/plain,{marker}":
                    return target["id"]
            await asyncio.sleep(0.2)
    raise RuntimeError("AI Deck browser was not found in the Steam CEF debugger.")


class CDP:
    def __init__(self, socket):
        self.socket = socket
        self.sequence = 0

    async def call(self, method, **params):
        self.sequence += 1
        await self.socket.send_json({"id": self.sequence, "method": method, "params": params})
        async with asyncio.timeout(6):
            while True:
                frame = await self.socket.receive()
                if frame.type != aiohttp.WSMsgType.TEXT:
                    raise RuntimeError("The Steam browser disconnected.")
                reply = json.loads(frame.data)
                if reply.get("id") == self.sequence:
                    if "error" in reply:
                        raise RuntimeError(f"The Steam browser could not run {method}.")
                    return reply.get("result", {})

    async def evaluate(self, expression):
        reply = await self.call("Runtime.evaluate", expression=expression, returnByValue=True)
        if "exceptionDetails" in reply:
            raise RuntimeError("The provider page could not be controlled.")
        return reply.get("result", {}).get("value")

    async def set_file(self, selector, path, expected_url):
        root = (await self.call("DOM.getDocument"))["root"]
        document = urlsplit(root["documentURL"])
        if document._replace(query="", fragment="").geturl().rstrip("/") != expected_url.rstrip("/"):
            raise RuntimeError("The selected provider page changed before the upload.")
        node = (await self.call("DOM.querySelector", nodeId=root["nodeId"], selector=selector))["nodeId"]
        if not node:
            raise RuntimeError("No file input is available. Sign in or attach the screenshot in the overlay.")
        await self.call("DOM.setFileInputFiles", nodeId=node, files=[str(path)])


async def socket_url(session, target_id):
    for target in await targets(session):
        if target.get("id") == target_id:
            path = urlsplit(target.get("webSocketDebuggerUrl", "")).path
            if path.startswith("/devtools/page/"):
                return f"ws://127.0.0.1:8080{path}"
    raise RuntimeError("The AI Deck browser is unavailable. Reload the plugin.")
