"""Read the built-in Steam Deck grip chord without claiming the HID device."""

import asyncio
import os
from pathlib import Path


def grip_chord(report):
    # Valve Deck state report: high button word starts at byte 12.
    if len(report) < 60 or report[:4] != bytes((1, 0, 9, 64)):
        return None
    return (report[13] & 0x06) == 0x06


def deck_devices():
    for node in Path("/sys/class/hidraw").glob("hidraw*"):
        try:
            info = (node / "device/uevent").read_text().upper()
        except OSError:
            continue
        if "HID_ID=0003:000028DE:00001205" in info.splitlines():
            yield Path("/dev") / node.name


async def watch_grips(on_press):
    readers = {}
    held = {}
    tick = 0
    try:
        while True:
            if tick == 0:
                for device in deck_devices():
                    if device not in readers:
                        try:
                            readers[device] = os.open(device, os.O_RDONLY | os.O_NONBLOCK)
                        except OSError:
                            pass
            tick = (tick + 1) % 80
            for device, fd in list(readers.items()):
                for _ in range(64):
                    try:
                        data = os.read(fd, 64)
                        if not data:
                            raise OSError("Controller disconnected")
                    except BlockingIOError:
                        break
                    except OSError:
                        os.close(readers.pop(device))
                        held.pop(device, None)
                        break
                    pressed = grip_chord(data)
                    if pressed is None:
                        continue
                    if pressed and held.get(device) is False:
                        await on_press()
                    held[device] = pressed
            await asyncio.sleep(0.025)
    finally:
        for fd in readers.values():
            os.close(fd)
