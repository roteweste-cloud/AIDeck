import { useEffect, useState, useSyncExternalStore } from "react";
import { BrowserContainer, browserClass } from "./browser";
import type { NativeBrowser } from "./steam";

export function Overlay({ view, label, leave, mounted, unmounted, loginMode, capture, keyboard,
  status, subscribe }: {
  view?: NativeBrowser;
  label: string;
  leave: () => void;
  mounted: () => void;
  unmounted: () => void;
  loginMode: boolean;
  capture: () => void;
  keyboard: () => void;
  status: () => string;
  subscribe: (listener: () => void) => () => void;
}) {
  const message = useSyncExternalStore(subscribe, status);
  const [reserveSpace, setReserveSpace] = useState(loginMode);
  const [inset, setInset] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    mounted();
    return unmounted;
  }, [mounted, unmounted]);
  useEffect(() => {
    // The browser is a native surface, so z-index alone cannot keep it
    // off the keyboard. Give its container a different rectangle instead.
    const update = () => {
      const keys = [...document.querySelectorAll('[class*="virtualkeyboard_KeyboardKey_"]')]
        .map(key => key.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight);
      let top = 0;
      let bottom = reserveSpace ? Math.round(innerHeight * 0.52) : 0;
      if (keys.length) {
        const first = Math.min(...keys.map(rect => rect.top));
        const last = Math.max(...keys.map(rect => rect.bottom));
        if ((first + last) / 2 < innerHeight / 2) {
          top = Math.min(innerHeight * 0.65, Math.ceil(last + 28));
          bottom = 0;
        } else {
          bottom = Math.min(innerHeight * 0.65, Math.ceil(innerHeight - first + 28));
        }
      }
      setInset(previous => previous.top === top && previous.bottom === bottom ? previous : { top, bottom });
    };
    update();
    const timer = window.setInterval(update, 120);
    return () => window.clearInterval(timer);
  }, [reserveSpace]);
  return (
    <div style={{ position: "fixed", top: inset.top, bottom: inset.bottom, left: 0, right: 0,
      display: "flex", flexDirection: "column", background: "#17191d" }}>
      <style>{".aideck-browser-surface { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; }"}</style>
      <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
        {view && BrowserContainer
          ? <BrowserContainer browser={view} visible external autoFocus hideForModals displayURLBar={false}
              className={`${browserClass ?? ""} aideck-browser-surface`} />
          : <p style={{ padding: 24 }}>This Steam version does not expose the browser used by AI Deck.</p>}
      </div>
      <footer style={{ padding: "6px 12px", background: "#24262c", fontSize: 13 }}>
        {message && <div role="status">{message}</div>}
        <button onClick={leave}>B / {label} · Back</button>
        <button onClick={() => { setReserveSpace(true); keyboard(); }}>Y · Keyboard</button>
        <button onClick={() => setReserveSpace(value => !value)}>{reserveSpace ? "Full view" : "Make room for keyboard"}</button>
        <button onClick={capture}>X · Send screenshot</button>
      </footer>
    </div>
  );
}
