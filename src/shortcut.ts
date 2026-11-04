export const GRACE_MS = 250;
export const TIMEOUT_MS = 10_000;
const names: Record<number, string> = {
  0: "A", 1: "B", 2: "X", 3: "Y", 4: "↑", 5: "→", 6: "↓", 7: "←",
  8: "Menu", 9: "View", 20: "↑", 21: "↓", 22: "←", 23: "→",
  28: "LT", 29: "RT", 30: "L1", 31: "R1", 32: "L4", 33: "R4",
  35: "Select", 36: "Start", 37: "Left trackpad", 39: "Right trackpad", 44: "L5", 45: "R5",
};
export const comboLabel = (buttons: number[]) => buttons.map(button => names[button] ?? `Button ${button}`).join(" + ");

// Steam's raw controller state follows the Steam Deck report layout:
// ulButtons holds the low 32 button bits, ulUpperButtons the high 32 bits.
const STATE_BITS: Record<number, [upper: boolean, bit: number]> = {
  0: [false, 7], 1: [false, 5], 2: [false, 6], 3: [false, 4],
  4: [false, 8], 5: [false, 9], 6: [false, 11], 7: [false, 10],
  8: [false, 14], 9: [false, 12], 25: [false, 22], 28: [false, 1], 29: [false, 0],
  30: [false, 3], 31: [false, 2], 32: [true, 9], 33: [true, 10], 34: [false, 13],
  35: [false, 12], 36: [false, 14], 37: [false, 17], 39: [false, 18], 41: [false, 26],
  44: [false, 15], 45: [false, 16],
};
export type StateInput = { unControllerIndex: number; ulButtons: number; ulUpperButtons: number };
export const stateSupports = (buttons: number[]) => buttons.length >= 2 && buttons.every(button => button in STATE_BITS);
export function statePressed(state: StateInput, button: number) {
  const entry = STATE_BITS[button];
  if (!entry) return false;
  const [upper, bit] = entry;
  return (((upper ? state.ulUpperButtons : state.ulButtons) >>> bit) & 1) === 1;
}

/**
 * Detects the shortcut from raw controller state. Steam only delivers
 * controller input messages while its UI has focus; state changes also
 * arrive while a game is in front.
 */
export class StateShortcut {
  private latched = new Map<number, boolean>();
  input(state: StateInput, buttons: number[]) {
    const active = stateSupports(buttons) && buttons.every(button => statePressed(state, button));
    const previous = this.latched.get(state.unControllerIndex);
    this.latched.set(state.unControllerIndex, active);
    return active && previous === false;
  }
  reset() { this.latched.clear(); }
}

type Result ={ buttons: number[] } | "short" | "timeout" | "cancelled";
type Controller = { held: Set<number>; deferred: Set<number>; latched: boolean };
type Recording = {
  start: number;
  index?: number;
  buttons: number[];
  done: (result: Result) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Shortcut {
  enabled = false;
  buttons = [32, 33];
  private controllers = new Map<number, Controller>();
  private recording?: Recording;

  record(done: Recording["done"]) {
    this.finish("cancelled");
    this.recording = {
      start: Date.now(), buttons: [], done,
      timer: setTimeout(() => this.finish("timeout"), TIMEOUT_MS),
    };
  }

  private finish(result: Result) {
    const recording = this.recording;
    if (!recording) return;
    this.recording = undefined;
    clearTimeout(recording.timer);
    recording.done(result);
  }

  cancelRecording() { this.finish("cancelled"); }
  isRecording() { return this.recording !== undefined; }

  reset() {
    this.cancelRecording();
    this.controllers.clear();
  }

  input(index: number, button: number, pressed: boolean): "fire" | "used" | "press" | undefined {
    const controller = this.controllers.get(index) ?? {
      held: new Set<number>(), deferred: new Set<number>(), latched: false,
    };
    this.controllers.set(index, controller);
    const wasHeld = controller.held.has(button);
    if (pressed) controller.held.add(button);
    else controller.held.delete(button);
    const recording = this.recording;
    if (recording) {
      if (pressed && !wasHeld && Date.now() - recording.start >= GRACE_MS
          && (recording.index === undefined || recording.index === index)) {
        recording.index = index;
        if (!recording.buttons.includes(button)) recording.buttons.push(button);
        clearTimeout(recording.timer);
        recording.timer = setTimeout(() => this.finish("timeout"), TIMEOUT_MS);
      }
      if (!pressed && recording.index === index && !recording.buttons.some(b => controller.held.has(b))) {
        this.finish(recording.buttons.length >= 2 ? { buttons: recording.buttons } : "short");
      }
      return "used";
    }
    const active = this.enabled && this.buttons.every(b => controller.held.has(b));
    const fire = active && !controller.latched && pressed && !wasHeld;
    controller.latched = active;
    if (fire) {
      controller.deferred.clear();
      return "fire";
    }
    if (active) return "used";
    // Wait for release on a hotkey button so an overlay action cannot run
    // while the player is still pressing the rest of a custom combo.
    if (!pressed && controller.deferred.delete(button)) return "press";
    if (this.enabled && this.buttons.includes(button)) {
      if (pressed && !wasHeld) controller.deferred.add(button);
      return "used";
    }
    return pressed && !wasHeld ? "press" : undefined;
  }
}
