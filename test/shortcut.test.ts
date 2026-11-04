import { afterEach, describe, expect, it, vi } from "vitest";
import { GRACE_MS, Shortcut, StateShortcut, TIMEOUT_MS, statePressed, stateSupports } from "../src/shortcut";

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

describe("AI Deck in-game shortcut", () => {
  const state = (low: number, high: number, index = 0) =>
    ({ unControllerIndex: index, ulButtons: low, ulUpperButtons: high });
  const L4 = 1 << 9;
  const R4 = 1 << 10;

  it("reads L4 and R4 from the upper Steam Deck button word", () => {
    expect(statePressed(state(0, L4), 32)).toBe(true);
    expect(statePressed(state(0, R4), 33)).toBe(true);
    expect(statePressed(state(L4 | R4, 0), 32)).toBe(false);
    expect(statePressed(state(1 << 15, 0), 44)).toBe(true);
    expect(statePressed(state(-2147483648, 0), 0)).toBe(false);
  });

  it("fires once on the rising edge per controller", () => {
    const shortcut = new StateShortcut();
    expect(shortcut.input(state(0, 0), [32, 33])).toBe(false);
    expect(shortcut.input(state(0, L4), [32, 33])).toBe(false);
    expect(shortcut.input(state(0, L4 | R4), [32, 33])).toBe(true);
    expect(shortcut.input(state(0, L4 | R4), [32, 33])).toBe(false);
    expect(shortcut.input(state(0, L4 | R4, 1), [32, 33])).toBe(false);
    expect(shortcut.input(state(0, 0), [32, 33])).toBe(false);
    expect(shortcut.input(state(0, L4 | R4), [32, 33])).toBe(true);
  });

  it("does not fire for combos without known state bits", () => {
    const shortcut = new StateShortcut();
    expect(stateSupports([32, 38])).toBe(false);
    shortcut.input(state(0, 0), [32, 38]);
    expect(shortcut.input(state(-1, -1), [32, 38])).toBe(false);
  });
});
