import asyncio
import ctypes as C
import os
import time
from pathlib import Path

SOURCE = Path("/tmp/gamescope.png")
PNG_START = b"\x89PNG\r\n\x1a\n"
PNG_END = b"\x00\x00\x00\x00IEND\xaeB`\x82"


def displays():
    candidates = []
    sources = [SOURCE]
    for process in Path("/proc").iterdir():
        if not process.name.isdecimal():
            continue
        try:
            name = (process / "comm").read_text().strip()
            if name in {"gamescope", "gamescope-wl"}:
                sources.append(process / "root/tmp/gamescope.png")
            if name.lower() == "xwayland":
                args = (process / "cmdline").read_bytes().split(b"\0")
                display = next((arg for arg in args if arg.startswith(b":") and arg[1:].isdigit()), None)
                if display and b"-auth" in args:
                    auth = args[args.index(b"-auth") + 1]
                    if auth.startswith(b"/"):
                        auth = os.fsencode(process / "root") + auth
                    candidates.append((1, display, auth))
                continue
            if name not in {"steam", "gamescope", "gamescope-wl", "steamwebhelper"}:
                continue
            env = dict(item.split(b"=", 1) for item in
                       (process / "environ").read_bytes().split(b"\0") if b"=" in item)
            if b"DISPLAY" in env:
                candidates.append((0 if name == "steam" else 2, env[b"DISPLAY"], env.get(b"XAUTHORITY")))
        except OSError:
            continue
    ordered = list(dict.fromkeys((display, auth) for _, display, auth in
                                sorted(candidates, key=lambda item: item[0])))
    return (ordered or [(b":0", None)]), sources


def request(display, auth, appid):
    x11 = C.CDLL("libX11.so.6")
    pointer, ulong, integer = C.c_void_p, C.c_ulong, C.c_int
    x11.XOpenDisplay.argtypes, x11.XOpenDisplay.restype = [C.c_char_p], pointer
    x11.XDefaultRootWindow.argtypes, x11.XDefaultRootWindow.restype = [pointer], ulong
    x11.XInternAtom.argtypes, x11.XInternAtom.restype = [pointer, C.c_char_p, integer], ulong
    x11.XChangeProperty.argtypes = [pointer, ulong, ulong, ulong, integer, integer, pointer, integer]
    x11.XSync.argtypes = [pointer, integer]
    x11.XCloseDisplay.argtypes = [pointer]
    x11.XFree.argtypes = [pointer]
    x11.XGetWindowProperty.argtypes = [
        pointer, ulong, ulong, C.c_long, C.c_long, integer, ulong,
        C.POINTER(ulong), C.POINTER(integer), C.POINTER(ulong),
        C.POINTER(ulong), C.POINTER(pointer),
    ]
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
        raise OSError("Xwayland display is unavailable")
    try:
        root = x11.XDefaultRootWindow(connection)
        focused = x11.XInternAtom(connection, b"GAMESCOPE_FOCUSED_APP_GFX", 1)
        if focused:
            atom_type, count, remaining = ulong(), ulong(), ulong()
            bits, data = integer(), pointer()
            try:
                x11.XGetWindowProperty(connection, root, focused, 0, 1, 0, 6,
                                       C.byref(atom_type), C.byref(bits), C.byref(count),
                                       C.byref(remaining), C.byref(data))
                if data and bits.value == 32 and count.value == 1:
                    focused_app = C.cast(data, C.POINTER(ulong))[0]
                    if focused_app > 769 and appid == "global":
                        appid = str(focused_app)
            finally:
                if data:
                    x11.XFree(data)
        if appid == "global":
            return None
        atom = x11.XInternAtom(connection, b"GAMESCOPECTRL_REQUEST_SCREENSHOT", 1)
        if not atom:
            raise OSError("The Xwayland display does not expose Gamescope capture")
        value = C.c_long(1)
        x11.XChangeProperty(connection, root, atom, 6, 32, 0, C.byref(value), 1)
        x11.XSync(connection, 0)
        return appid
    finally:
        x11.XCloseDisplay(connection)


def fingerprint(source):
    try:
        stat = source.stat()
        return stat.st_ino, stat.st_mtime_ns, stat.st_size
    except OSError:
        return None


async def read_new(before, destination):
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        await asyncio.sleep(0.1)
        for source, previous in before.items():
            current = fingerprint(source)
            if current is None or current == previous:
                continue
            try:
                data = source.read_bytes()
            except OSError:
                continue
            if data.startswith(PNG_START) and data.endswith(PNG_END) and fingerprint(source) == current:
                destination.write_bytes(data)
                return True
    return False


async def capture(destination, appid):
    candidates, sources = displays()
    requested = False
    for display, auth in candidates:
        before = {source: fingerprint(source) for source in sources}
        try:
            detected = await asyncio.to_thread(request, display, auth, appid)
        except OSError:
            continue
        if detected:
            requested = True
            if await read_new(before, destination):
                return detected
    if requested:
        raise RuntimeError("Gamescope did not write a fresh screenshot.")
    if appid == "global":
        raise RuntimeError("Steam and Gamescope did not identify a running game.")
    raise RuntimeError("Could not connect to a Gamescope Xwayland display.")
