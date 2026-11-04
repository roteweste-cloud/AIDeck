import { afterEach, describe, expect, it, vi } from "vitest";
import { GRACE_MS, Shortcut, TIMEOUT_MS } from "../src/shortcut";

afterEach(() => vi.useRealTimers());
function enabled() {
  const shortcut = new Shortcut();
  shortcut.enabled = true;
  return shortcut;
}

describe("AI Deck Hotkey", () => {
  it("fires once per press, on one controller only", () => {
    const shortcut = enabled();
    expect(shortcut.input(0, 32, true)).not.toBe("fire");
    expect(shortcut.input(1, 33, true)).not.toBe("fire");
    expect(shortcut.input(0, 33, true)).toBe("fire");
    expect(shortcut.input(0, 33, true)).not.toBe("fire");
    expect(shortcut.input(0, 10, true)).not.toBe("fire");
    shortcut.input(0, 33, false);
    expect(shortcut.input(0, 33, true)).toBe("fire");
  });

  it("clears held buttons when Steam's listener is recreated", () => {
    const shortcut = enabled();
    shortcut.input(0, 32, true);
    shortcut.reset();
    expect(shortcut.input(0, 33, true)).not.toBe("fire");
  });

  it("defers a shared overlay action until release and suppresses it for the combo", () => {
    const shortcut = enabled();
    shortcut.buttons = [2, 3];
    expect(shortcut.input(0, 2, true)).toBe("used");
    expect(shortcut.input(0, 2, false)).toBe("press");
    expect(shortcut.input(0, 2, true)).toBe("used");
    expect(shortcut.input(0, 3, true)).toBe("fire");
    expect(shortcut.input(0, 2, false)).not.toBe("press");
    expect(shortcut.input(0, 3, false)).not.toBe("press");
  });

  it("ignores the button used to start recording", () => {
    vi.useFakeTimers();
    const shortcut = enabled();
    const done = vi.fn();
    shortcut.input(0, 0, true);
    shortcut.record(done);
    shortcut.input(0, 2, true);
    vi.advanceTimersByTime(GRACE_MS);
    shortcut.input(0, 0, true);
    shortcut.input(0, 2, false);
    shortcut.input(0, 44, true);
    shortcut.input(0, 45, true);
    shortcut.input(0, 44, false);
    expect(done).not.toHaveBeenCalled();
    shortcut.input(0, 45, false);
    expect(done).toHaveBeenCalledWith({ buttons: [44, 45] });
  });

  it("rejects a single button and times out unattended recordings", () => {
    vi.useFakeTimers();
    const shortcut = enabled();
    const done = vi.fn();
    shortcut.record(done);
    vi.advanceTimersByTime(GRACE_MS);
    shortcut.input(0, 32, true);
    shortcut.input(0, 32, false);
    expect(done).toHaveBeenLastCalledWith("short");
    shortcut.record(done);
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(done).toHaveBeenLastCalledWith("timeout");
    expect(shortcut.buttons).toEqual([32, 33]);
  });
});
