import { addEventListener, call, definePlugin, removeEventListener, routerHook, toaster } from "@decky/api";
import { ChatBrowser } from "./browser";
import { ROUTE, resumeGame, runningGame, showOverlay } from "./navigation";
import { Overlay } from "./overlay";
import { SettingsPanel, type Provider, type Settings } from "./settings";
import { Shortcut, StateShortcut, comboLabel } from "./shortcut";
import { steam, drop } from "./steam";

const CAPTURE_TIMEOUT_MS = 14000;

export default definePlugin(() => {
  const shortcut = new Shortcut();
  const stateShortcut = new StateShortcut();
  const browser = new ChatBrowser();
  let overlay = false;
  let opening = false;
  let pendingClose = false;
  let busy = false;
  let disposed = false;
  let generation = 0;
  let game = runningGame();
  let provider: Provider = "chatgpt";
  let overlayProvider: Provider = provider;
  let loginMode = false;
  let message = "";
  let keyboardRequests = 0;
  let openingTimer: number | undefined;
  let finishOpening: ((opened: boolean) => void) | undefined;
  const statusEvents = new EventTarget();
  const status = () => message;
  const keyboardRequested = () => keyboardRequests;
  const subscribe = (listener: () => void) => {
    statusEvents.addEventListener("change", listener);
    return () => statusEvents.removeEventListener("change", listener);
  };
  const setStatus = (value: string) => {
    message = value;
    statusEvents.dispatchEvent(new Event("change"));
  };

  const notify = (error: unknown) => {
    if (!disposed) toaster.toast({ title: "AI Deck", body: error instanceof Error ? error.message : String(error) });
  };
  const load = () => call<[], Settings>("get_settings");
  const apply = (settings: Settings) => {
    provider = settings.provider;
    shortcut.enabled = settings.enabled;
    shortcut.buttons = settings.buttons;
  };
  const save = async (settings: Settings) => {
    if (busy && settings.provider !== provider) throw new Error("Wait for the current AI request to finish.");
    await call<[Settings], void>("set_settings", settings);
    apply(settings);
  };
  void load().then(apply).catch(notify);

  const mounted = () => { overlay = true; finishOpening?.(true); };
  const unmounted = () => {
    overlay = false;
    opening = false;
    clearTimeout(openingTimer);
    finishOpening?.(false);
    generation++;
    browser.blur();
  };
  const leave = () => {
    if (pendingClose) return;
    pendingClose = true;
    generation++;
    finishOpening?.(false);
    browser.blur();
    try { resumeGame(); }
    catch (error) { pendingClose = false; notify(error); }
  };
  const open = async () => {
    browser.start();
    if (overlay) return true;
    opening = true;
    pendingClose = false;
    const mounted = new Promise<boolean>(resolve => {
      finishOpening = opened => {
        clearTimeout(openingTimer);
        opening = false;
        finishOpening = undefined;
        resolve(opened);
      };
      openingTimer = window.setTimeout(() => finishOpening?.(false), 4000);
    });
    try { showOverlay(); }
    catch (error) { finishOpening?.(false); throw error; }
    const opened = await mounted;
    if (!opened && !pendingClose && !disposed) throw new Error("Steam did not open the AI Deck chat window. Try the Decky button again.");
    return opened;
  };

  const screenshot = async (fromOverlay = false) => {
    if (busy || disposed) return;
    const id = generation;
    let current = fromOverlay ? game : runningGame();
    const selected = fromOverlay ? overlayProvider : provider;
    busy = true;
    let captured = false;
    let captureError = "";
    loginMode = false;
    setStatus("Capturing screenshot…");
    if (!fromOverlay && !disposed) {
      toaster.toast({ title: "AI Deck", body: "Capturing screenshot…", duration: 1500 });
    }
    try {
      {
        try {
          // Never leave the player waiting on a stuck capture: open the chat anyway.
          let timeout: number | undefined;
          const appid = await Promise.race([
            call<[string], string>("capture", current.appid),
            new Promise<never>((_, reject) => {
              timeout = window.setTimeout(() => reject(new Error("Gamescope did not respond in time.")), CAPTURE_TIMEOUT_MS);
            }),
          ]).finally(() => clearTimeout(timeout));
          if (appid !== current.appid) current = { appid, name: `Steam game ${appid}` };
          captured = true;
        } catch (error) {
          captureError = error instanceof Error ? error.message : String(error);
        }
      }
      if (disposed || generation !== id) return;
      game = current;
      overlayProvider = selected;
      if (!await open()) return;
      try { await browser.ready(); }
      catch (error) {
        browser.view?.LoadURL(await call<[string, Provider], string>("chat_for_game", game.appid, selected));
        throw error;
      }
      if (disposed || generation !== id) return;
      if (captured) {
        setStatus("Screenshot captured. Waiting for the provider…");
        await call<[string, string, Provider], void>("send_to_chat", game.appid, game.name, selected);
        setStatus("Screenshot and prompt sent.");
      } else {
        browser.view?.LoadURL(await call<[string, Provider], string>("chat_for_game", game.appid, selected));
        if (captureError) setStatus(`Screenshot capture failed: ${captureError}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      notify(error);
    } finally {
      if (captured) {
        try { await call("discard"); }
        catch (error) { notify(error); }
      }
      busy = false;
    }
  };

  const openChat = async (reset = false, fromOverlay = false) => {
    if (busy || disposed) return;
    busy = true;
    try {
      game = fromOverlay ? game : runningGame();
      const selected = fromOverlay ? overlayProvider : provider;
      overlayProvider = selected;
      loginMode = !reset;
      setStatus(reset ? "" : "Sign in here, then choose X · Send screenshot in a running game.");
      if (!await open()) return;
      const view = browser.view;
      // Manual login remains available if Steam's debugger cannot connect.
      try { await browser.ready(); } catch (error) { notify(error); }
      if (disposed) return;
      const url = await call<[string, Provider], string>(reset ? "reset_chat" : "chat_for_game", game.appid, selected);
      view?.LoadURL(url);
      if (reset) notify("A new chat is ready. The previous conversation stays in your provider history.");
    } catch (error) { notify(error); }
    finally { busy = false; }
  };

  const keyboard = async () => {
    // Let the overlay shrink the browser before Steam draws the keyboard,
    // also when Y comes from the controller instead of the footer button.
    keyboardRequests++;
    statusEvents.dispatchEvent(new Event("change"));
    if (busy) return;
    try {
      // On login pages the browser already owns the focused email/password field.
      // Composer detection only applies to the provider's chat page.
      try { await call<[string, Provider], boolean>("browser_action", "focus", overlayProvider); }
      catch (error) { console.warn("AI Deck: Composer focus", error); }
      if (!overlay || pendingClose) return;
      const view = browser.view;
      view?.m_browserView.SetFocus(true);
      if (view?.m_refKeyboard) {
        view.m_refKeyboard.SetAsCurrentVirtualKeyboardTarget?.();
        view.m_refKeyboard.ShowVirtualKeyboard();
      }
      else if (steam.SteamClient?.System?.OpenVirtualKeyboard) steam.SteamClient.System.OpenVirtualKeyboard();
      else notify("Open the on-screen keyboard with Steam + X.");
    } catch (error) { notify(error); }
  };
  const pageKey = (key: number) => {
    const input = steam.SteamClient?.Input;
    input?.ControllerKeyboardSetKeyState?.(key, true);
    input?.ControllerKeyboardSetKeyState?.(key, false);
  };

  type Source = "steam" | "state" | "hid";
  let lastTrigger: { source: Source; time: number } | undefined;
  const trigger = (source: Source) => {
    if (disposed || !shortcut.enabled || (!overlay && !opening && busy)) return;
    const time = performance.now();
    if (lastTrigger && lastTrigger.source !== source && time - lastTrigger.time < 500) return;
    lastTrigger = { source, time };
    if (overlay || opening) leave();
    else void screenshot();
  };
  const gripShortcut = () => {
    if (shortcut.buttons.length === 2 && shortcut.buttons.includes(32) && shortcut.buttons.includes(33)
        && !shortcut.isRecording()) trigger("hid");
  };
  addEventListener("grip_shortcut", gripShortcut);

  let registration: Parameters<typeof drop>[0];
  let stateRegistration: Parameters<typeof drop>[0];
  const listen = () => {
    drop(registration);
    drop(stateRegistration);
    shortcut.reset();
    stateShortcut.reset();
    // Input messages only arrive while Steam's UI has focus. Raw state changes
    // also arrive in-game, which is where the shortcut has to open the overlay.
    stateRegistration = steam.SteamClient?.Input?.RegisterForControllerStateChanges?.(changes => {
      try {
        if (disposed || !shortcut.enabled || shortcut.isRecording()) return;
        for (const state of changes) {
          if (stateShortcut.input(state, shortcut.buttons)) trigger("state");
        }
      } catch (error) { console.warn("AI Deck: Controller state", error); }
    });
    registration = steam.SteamClient?.Input?.RegisterForControllerInputMessages?.((index, button, pressed) => {
      try {
        const action = shortcut.input(index, button, Boolean(pressed));
        if (action === "fire") {
          trigger("steam");
          return;
        }
        if (action !== "press" || !overlay || pendingClose) return;
        if (button === 1) leave();
        if (button === 2) void screenshot(true);
        if (button === 3) void keyboard();
        if (button === 8 || button === 36) void openChat(true, true);
        if (button === 4 || button === 20) pageKey(75);
        if (button === 6 || button === 21) pageKey(78);
      } catch (error) { notify(error); }
    });
  };
  let lastTick = Date.now();
  const timer = window.setInterval(() => {
    const now = Date.now();
    if ((!registration && !stateRegistration) || now - lastTick > 15_000) listen();
    lastTick = now;
  }, 2000);
  listen();

  routerHook.addRoute(ROUTE, () => (
    <Overlay view={browser.view} label={comboLabel(shortcut.buttons)}
      leave={leave} mounted={mounted} unmounted={unmounted} loginMode={loginMode} keyboardRequested={keyboardRequested}
      capture={() => void screenshot(true)} keyboard={() => void keyboard()} status={status} subscribe={subscribe} />
  ));
  try { browser.start(); } catch (error) { console.warn("AI Deck: Browser startup", error); }
  return {
    name: "AI Deck",
    titleView: <span>AI Deck</span>,
    icon: <span>AI</span>,
    content: <SettingsPanel shortcut={shortcut} load={load} save={save}
      open={() => void openChat()} capture={() => void screenshot()} reset={() => void openChat(true)} report={notify} />,
    onDismount() {
      disposed = true;
      generation++;
      clearInterval(timer);
      finishOpening?.(false);
      removeEventListener("grip_shortcut", gripShortcut);
      drop(registration);
      drop(stateRegistration);
      shortcut.reset();
      routerHook.removeRoute(ROUTE);
      browser.destroy();
    },
  };
});
