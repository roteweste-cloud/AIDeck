import { Navigation, Router } from "@decky/ui";
import { steam, type Game } from "./steam";

export const ROUTE = "/aideck";
export function runningGame(): Game {
  const game = Router?.MainRunningApp as { appid?: number; display_name?: string } | undefined;
  return game?.appid ? { appid: String(game.appid), name: game.display_name || `Steam game ${game.appid}` }
    : { appid: "global", name: "Steam Deck" };
}

export function showOverlay() {
  Navigation.CloseSideMenus();
  Navigation.Navigate(ROUTE);
}

export function resumeGame() {
  const game = runningGame();
  if (game.appid === "global") {
    Navigation.NavigateBack();
    return;
  }
  try {
    const store = steam.SteamUIStore;
    store?.SetRunningApp(Number(game.appid));
    if (store?.NavigateToRunningApp) {
      store.NavigateToRunningApp(false);
      return;
    }
  } catch (error) {
    console.warn("AI Deck: Steam-Navigation", error);
  }
  Navigation.Navigate("/apprunning");
}
