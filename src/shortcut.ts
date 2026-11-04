export const GRACE_MS = 250;
export const TIMEOUT_MS = 10_000;
const names: Record<number, string> = {
  0: "A", 1: "B", 2: "X", 3: "Y", 4: "↑", 5: "→", 6: "↓", 7: "←",
  8: "Menu", 9: "View", 20: "↑", 21: "↓", 22: "←", 23: "→",
  28: "LT", 29: "RT", 30: "L1", 31: "R1", 32: "L4", 33: "R4",
  35: "Select", 36: "Start", 37: "Left trackpad", 39: "Right trackpad", 44: "L5", 45: "R5",
};
export const comboLabel = (buttons: number[]) => buttons.map(button => names[button] ?? `Button ${button}`).join(" + ");

type Result = { buttons: number[] } | "short" | "timeout" | "cancelled";
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
