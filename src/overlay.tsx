import { findClassModule, Router } from "@decky/ui";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BrowserContainer, browserClass } from "./browser";
import type { NativeBrowser } from "./steam";

// Recent Steam builds hash class names, so look the key class up by module key
// and keep the readable prefix as a fallback for older builds.
const keyboardClasses = findClassModule(module => typeof module.KeyboardKey === "string"
  && (typeof module.Keyboard === "string" || typeof module.VirtualKeyboardContainer === "string")) as
  Record<string, string> | undefined;
const KEY_SELECTOR = ['[class*="virtualkeyboard_KeyboardKey_"]',
  ...(keyboardClasses?.KeyboardKey ? [`.${CSS.escape(keyboardClasses.KeyboardKey.split(" ")[0])}`] : [])].join(", ");
const RESERVE = 0.55;
const MAX_INSET = 0.65;
const GAP = 28;

function keyboardDocuments(own: Document) {
  // Plugin code runs in SharedJSContext: the global document is not the Game
  // Mode window. Search the overlay's own window and every Steam UI window.
  const documents = new Set<Document>([own]);
  try {
    const store = Router?.WindowStore as { SteamUIWindows?: { BrowserWindow?: Window }[] } | undefined;
    for (const instance of store?.SteamUIWindows ?? []) {
      const doc = instance.BrowserWindow?.document;
      if (doc) documents.add(doc);
    }
  } catch { /* Steam UI layout changed; the owner document is enough. */ }
  return documents;
}

function keyboardRect(own: Document, height: number) {
  let top = Infinity;
  let bottom = -Infinity;
  for (const doc of keyboardDocuments(own)) {
    // Keys in a separate keyboard window share the screen with our window.
    for (const key of doc.querySelectorAll(KEY_SELECTOR)) {
      const rect = key.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= height) continue;
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
  }
  return top < bottom ? { top, bottom } : undefined;
}

export function Overlay({ view, label, leave, mounted, unmounted, loginMode, keyboardRequested, capture, keyboard,
  status, subscribe }: {
  view?: NativeBrowser;
  label: string;
  leave: () => void;
  mounted: () => void;
  unmounted: () => void;
  loginMode: boolean;
  keyboardRequested: () => number;
  capture: () => void;
  keyboard: () => void;
  status: () => string;
  subscribe: (listener: () => void) => () => void;
}) {
  const message = useSyncExternalStore(subscribe, status);
  const [reserveSpace, setReserveSpace] = useState(loginMode);
  const [inset, setInset] = useState({ top: 0, bottom: 0 });
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted();
    return unmounted;
  }, [mounted, unmounted]);
  const keyboardRequests = useSyncExternalStore(subscribe, keyboardRequested);
  const firstRequest = useRef(keyboardRequests);
  useEffect(() => { if (loginMode) setReserveSpace(true); }, [loginMode]);
  useEffect(() => {
    if (keyboardRequests !== firstRequest.current) setReserveSpace(true);
  }, [keyboardRequests]);
  useEffect(() => {
    const own = root.current?.ownerDocument ?? document;
    const win = own.defaultView ?? window;
    // The browser is a native surface drawn above Steam's HTML keyboard, so
    // z-index cannot help. Shrink its rectangle so the keyboard stays visible.
    const update = () => {
      const height = win.innerHeight;
      const keys = keyboardRect(own, height);
      let top = 0;
      let bottom = reserveSpace ? Math.round(height * RESERVE) : 0;
      if (keys) {
        if ((keys.top + keys.bottom) / 2 < height / 2) {
          top = Math.min(height * MAX_INSET, Math.ceil(keys.bottom + GAP));
          bottom = 0;
        } else {
          bottom = Math.min(height * MAX_INSET, Math.max(bottom, Math.ceil(height - keys.top + GAP)));
        }
      }
      setInset(previous => previous.top === top && previous.bottom === bottom ? previous : { top, bottom });
      syncBounds();
    };
    // Steam's container does not always follow a resize of its parent. Keep the
    // native view inside our surface; the width calibrates the pixel scale.
    const syncBounds = () => {
      const native = view?.m_browserView;
      const rect = surface.current?.getBoundingClientRect();
      if (!native?.GetBounds || !native.SetBounds || !rect || rect.width <= 0 || rect.height <= 0) return;
      try {
        const bounds = native.GetBounds();
        if (!bounds || bounds.width <= 0) return;
        const scale = bounds.width / rect.width;
        const y = Math.round(rect.top * scale);
        const h = Math.round(rect.height * scale);
        if (Math.abs(bounds.y - y) > 2 || Math.abs(bounds.height - h) > 2) native.SetBounds(bounds.x, y, bounds.width, h);
      } catch (error) { console.warn("AI Deck: Browser bounds", error); }
    };
    update();
    const timer = win.setInterval(update, 120);
    return () => win.clearInterval(timer);
  }, [reserveSpace, view]);
  return (
    <div ref={root} style={{ position: "fixed", top: inset.top, bottom: inset.bottom, left: 0, right: 0,
      display: "flex", flexDirection: "column", background: "#17191d" }}>
      <style>{".aideck-browser-surface { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; }"}</style>
      <div ref={surface} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
        {view && BrowserContainer
          ? <BrowserContainer browser={view} visible external autoFocus hideForModals displayURLBar={false}
              className={`${browserClass ?? ""} aideck-browser-surface`} />
          : <p style={{ padding: 24 }}>This Steam version does not expose the browser used by AI Deck.</p>}
      </div>
      <footer style={{ padding: "6px 12px", background: "#24262c", fontSize: 13 }}>
        {message && <div role="status">{message}</div>}
        <button onClick={leave}>B / {label} · Back</button>
        <button onClick={keyboard}>Y · Keyboard</button>
        <button onClick={() => setReserveSpace(value => !value)}>{reserveSpace ? "Full view" : "Make room for keyboard"}</button>
        <button onClick={capture}>X · Send screenshot</button>
      </footer>
    </div>
  );
}
