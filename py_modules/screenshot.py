import asyncio
import ctypes as C
import os
import shutil
import time
from pathlib import Path

SOURCE = Path("/tmp/gamescope.png")
PNG_START = b"\x89PNG\r\n\x1a\n"
PNG_END = b"\x00\x00\x00\x00IEND\xaeB`\x82"


def displays():
    candidates = []
    for process in Path("/proc").iterdir():
        if not process.name.isdecimal():
            continue
        try:
            name = (process / "comm").read_text().strip()
            if name not in {"steam", "gamescope", "gamescope-wl", "steamwebhelper"}:
                continue
            env = dict(item.split(b"=", 1) for item in
                       (process / "environ").read_bytes().split(b"\0") if b"=" in item)
            if b"DISPLAY" in env:
                candidates.append((name != "steam", env[b"DISPLAY"], env.get(b"XAUTHORITY")))
        except OSError:
            continue
    return list(dict.fromkeys((display, auth) for _, display, auth in
                             sorted(candidates, key=lambda item: item[0]))) or [(b":0", None)]


def request(display, auth):
    x11 = C.CDLL("libX11.so.6")
    pointer, ulong, integer = C.c_void_p, C.c_ulong, C.c_int
    x11.XOpenDisplay.argtypes, x11.XOpenDisplay.restype = [C.c_char_p], pointer
    x11.XDefaultRootWindow.argtypes, x11.XDefaultRootWindow.restype = [pointer], ulong
    x11.XInternAtom.argtypes, x11.XInternAtom.restype = [pointer, C.c_char_p, integer], ulong
    x11.XChangeProperty.argtypes = [pointer, ulong, ulong, ulong, integer, integer, pointer, integer]
    x11.XSync.argtypes = [pointer, integer]
    x11.XCloseDisplay.argtypes = [pointer]
    original = os.environ.get("XAUTHORITY")
    try:
        if auth:
            os.environ["XAUTHORITY"] = os.fsdecode(auth)
        connection = x11.XOpenDisplay(display)
    finally:
        if original is None:
            os.environ.pop("XAUTHORITY", None)
        else:
            os.environ["XAUTHORITY"] = original
    if not connection:
        raise OSError("Xwayland-Display nicht erreichbar")
    try:
        atom = x11.XInternAtom(connection, b"GAMESCOPECTRL_REQUEST_SCREENSHOT", 0)
        value = C.c_long(1)
        x11.XChangeProperty(connection, x11.XDefaultRootWindow(connection), atom,
                            6, 32, 0, C.byref(value), 1)
        x11.XSync(connection, 0)
    finally:
        x11.XCloseDisplay(connection)


def fingerprint():
    try:
        stat = SOURCE.stat()
        return stat.st_ino, stat.st_mtime_ns, stat.st_size
    except FileNotFoundError:
        return None


async def read_new(before, destination):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        await asyncio.sleep(0.1)
        current = fingerprint()
        if current is None or current == before:
            continue
        try:
            data = SOURCE.read_bytes()
        except FileNotFoundError:
            continue
        if data.startswith(PNG_START) and data.endswith(PNG_END) and fingerprint() == current:
            destination.write_bytes(data)
            return True
    return False


async def capture(destination):
    candidates = displays()
    for display, auth in candidates:
        before = fingerprint()
        try:
            await asyncio.to_thread(request, display, auth)
        except OSError:
            continue
        if await read_new(before, destination):
            return

    cli = shutil.which("gamescopectl")
    if cli:
        display, auth = candidates[0]
        env = {**os.environ, "DISPLAY": os.fsdecode(display)}
        if auth:
            env["XAUTHORITY"] = os.fsdecode(auth)
        before = fingerprint()
        process = await asyncio.create_subprocess_exec(
            cli, "screenshot", env=env, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL)
        try:
            await asyncio.wait_for(process.wait(), timeout=4)
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
        if process.returncode == 0 and await read_new(before, destination):
            return
    raise RuntimeError("Gamescope hat keinen Screenshot geliefert. Bitte im Game Mode versuchen.")
