type Registration = { unregister?: () => void; Unregister?: () => void };
export type NativeBrowser = {
  LoadURL: (url: string) => void;
  Destroy: () => void;
  m_refKeyboard?: { ShowVirtualKeyboard: () => void; SetAsCurrentVirtualKeyboardTarget?: () => void };
  m_browserView: { SetFocus: (focused: boolean) => void };
};
export type Game = { appid: string; name: string };
export const steam = window as Window & {
  SteamUIStore?: {
    SetRunningApp: (appid: number) => void;
    NavigateToRunningApp?: (force: boolean) => void;
  };
  SteamClient?: {
    Input?: {
      RegisterForControllerInputMessages?: (callback: (index: number, button: number, pressed: boolean) => void) => Registration;
      ControllerKeyboardSetKeyState?: (key: number, pressed: boolean) => void;
    };
    System?: { OpenVirtualKeyboard?: () => void };
  };
};

export function drop(registration?: Registration) {
  (registration?.unregister ?? registration?.Unregister)?.call(registration);
}
