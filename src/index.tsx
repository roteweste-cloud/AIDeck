import { call, definePlugin, routerHook, toaster } from "@decky/api";
import { ChatBrowser, HOME } from "./browser";
import { ROUTE, resumeGame, runningGame, showOverlay } from "./navigation";
import { Overlay } from "./overlay";
import { SettingsPanel, type Settings } from "./settings";
import { Shortcut, comboLabel } from "./shortcut";
import { steam, drop } from "./steam";

export default definePlugin(() => {
  const shortcut = new Shortcut();
  const browser = new ChatBrowser();
  let overlay = false;
  let opening = false;
  let pendingClose = false;
  let busy = false;
  let disposed = false;
  let generation = 0;
  let game = runningGame();

  const notify = (error: unknown) => {
    if (!disposed) toaster.toast({ title: "AI Deck", body: error instanceof Error ? error.message : String(error) });
  };
  const load = () => call<[], Settings>("get_settings");
  const apply = (settings: Settings) => {
    shortcut.enabled = settings.enabled;
    shortcut.buttons = settings.buttons;
  };
  const save = async (settings: Settings) => {
    await call<[Settings], void>("set_settings", settings);
    apply(settings);
  };
  void load().then(apply).catch(notify);

  const mounted = () => { overlay = true; opening = false; };
  const unmounted = () => {
    overlay = false;
    opening = false;
    generation++;
    browser.blur();
  };
  const leave = () => {
    if (pendingClose) return;
    pendingClose = true;
    generation++;
    browser.blur();
    try { resumeGame(); }
    catch (error) { pendingClose = false; notify(error); }
  };
  const open = () => {
    browser.start();
    if (!overlay && !opening) {
      opening = true;
      pendingClose = false;
      try { showOverlay(); }
      catch (error) { opening = false; throw error; }
    }
  };

  const screenshot = async (fromOverlay = false) => {
    if (busy || disposed) return;
    const id = generation;
    const current = fromOverlay ? game : runningGame();
    busy = true;
    let captured = false;
    try {
      if (current.appid !== "global") {
        await call("capture");
        captured = true;
      }
      if (disposed || generation !== id) return;
      game = current;
      open();
      await browser.ready();
      if (disposed || generation !== id) return;
      if (captured) await call<[string, string], void>("send_to_chat", game.appid, game.name);
      else browser.view?.LoadURL(await call<[string], string>("chat_for_game", game.appid));
    } catch (error) {
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
      open();
      const view = browser.view;
      // Manual login remains available if Steam's debugger cannot connect.
      try { await browser.ready(); } catch (error) { notify(error); }
      if (disposed) return;
      if (reset) await call<[string], void>("reset_chat", game.appid);
      view?.LoadURL(reset ? HOME : await call<[string], string>("chat_for_game", game.appid));
      if (reset) notify("Ein neuer Chat ist bereit. Der bisherige Chat bleibt in ChatGPT erhalten.");
    } catch (error) { notify(error); }
    finally { busy = false; }
  };

  const keyboard = async () => {
    if (busy) return;
    try {
      const focused = await call<[string], boolean>("browser_action", "focus");
      if (!overlay || pendingClose) return;
      if (!focused) throw new Error("Das ChatGPT-Eingabefeld ist noch nicht bereit.");
      const view = browser.view;
      view?.m_browserView.SetFocus(true);
      if (view?.m_refKeyboard) view.m_refKeyboard.ShowVirtualKeyboard();
      else if (steam.SteamClient?.System?.OpenVirtualKeyboard) steam.SteamClient.System.OpenVirtualKeyboard();
      else notify("Bildschirmtastatur über Steam + X öffnen.");
    } catch (error) { notify(error); }
  };
  const pageKey = (key: number) => {
    const input = steam.SteamClient?.Input;
    input?.ControllerKeyboardSetKeyState?.(key, true);
    input?.ControllerKeyboardSetKeyState?.(key, false);
  };

  let registration: Parameters<typeof drop>[0];
  const listen = () => {
    drop(registration);
    shortcut.reset();
    registration = steam.SteamClient?.Input?.RegisterForControllerInputMessages?.((index, button, pressed) => {
      try {
        const action = shortcut.input(index, button, Boolean(pressed));
        if (action === "fire") {
          if (overlay || opening) leave();
          else void screenshot();
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
    if (!registration || now - lastTick > 15_000) listen();
    lastTick = now;
  }, 2000);
  listen();

  routerHook.addRoute(ROUTE, () => (
    <Overlay view={browser.view} label={comboLabel(shortcut.buttons)}
      leave={leave} mounted={mounted} unmounted={unmounted} />
  ));
  try { browser.start(); } catch (error) { console.warn("AI Deck: Browser-Start", error); }
  return {
    name: "AI Deck",
    titleView: <span>AI Deck</span>,
    icon: <span>AI</span>,
    content: <SettingsPanel shortcut={shortcut} load={load} save={save}
      open={() => void openChat()} reset={() => void openChat(true)} report={notify} />,
    onDismount() {
      disposed = true;
      generation++;
      clearInterval(timer);
      drop(registration);
      shortcut.reset();
      routerHook.removeRoute(ROUTE);
      browser.destroy();
    },
  };
});
