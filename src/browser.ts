import { call } from "@decky/api";
import { findClassModule, findModuleChild, Router } from "@decky/ui";
import type { ComponentType } from "react";
import type { NativeBrowser } from "./steam";

export const HOME = "https://chatgpt.com/";
type BrowserProps = {
  browser: NativeBrowser; visible: boolean; external: boolean; autoFocus: boolean;
  displayURLBar: boolean; hideForModals: boolean; className?: string;
};
export const BrowserContainer = findModuleChild(module => {
  if (!module || typeof module !== "object") return undefined;
  return Object.values(module).find(value => typeof value === "function"
    && value.toString().includes("displayURLBar") && value.toString().includes("BExternalTriggeredLoad()"));
}) as ComponentType<BrowserProps> | undefined;
export const browserClass = findClassModule(module => !!module.ExternalBrowserContainer
  && !!module.MainBrowserContainer)?.ExternalBrowserContainer;

export class ChatBrowser {
  view?: NativeBrowser;
  private registration?: Promise<void>;

  start() {
    if (this.view) return this.view;
    const windowStore = Router?.WindowStore?.GamepadUIMainWindowInstance;
    const view = windowStore?.CreateBrowserView?.("AIDeck", {}) as NativeBrowser | undefined;
    if (!view) throw new Error("Steam-Browser ist im Game Mode nicht verfügbar.");
    this.view = view;
    const marker = crypto.randomUUID();
    view.LoadURL(`data:text/plain,${marker}`);
    this.registration = call<[string], void>("register_browser", marker).finally(() => {
      if (this.view === view) view.LoadURL(HOME);
    });
    void this.registration.catch(error => console.warn("AI Deck: Browser-Registrierung", error));
    return view;
  }

  async ready() { await this.registration; }
  blur() { this.view?.m_browserView?.SetFocus(false); }
  destroy() {
    this.blur();
    this.view?.Destroy();
    this.view = undefined;
  }
}
