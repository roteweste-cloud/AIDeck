import { useEffect } from "react";
import { BrowserContainer, browserClass } from "./browser";
import type { NativeBrowser } from "./steam";

export function Overlay({ view, label, leave, mounted, unmounted }: {
  view?: NativeBrowser;
  label: string;
  leave: () => void;
  mounted: () => void;
  unmounted: () => void;
}) {
  useEffect(() => {
    mounted();
    return unmounted;
  }, [mounted, unmounted]);
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#17191d", zIndex: 100 }}>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {view && BrowserContainer
          ? <BrowserContainer browser={view} visible external autoFocus hideForModals displayURLBar={false} className={browserClass} />
          : <p style={{ padding: 24 }}>Diese Steam-Version stellt den Browser für AI Deck nicht bereit.</p>}
      </div>
      <footer style={{ padding: "10px 16px", background: "#24262c", fontSize: 13, zIndex: 1 }}>
        <button onClick={leave}>B / {label} · Zurück</button>
        {"  ·  Y Tastatur  ·  X Screenshot  ·  Start Neuer Chat  ·  ↑↓ Scrollen"}
      </footer>
    </div>
  );
}
