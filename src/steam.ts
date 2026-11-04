type Registration = { unregister?: () => void; Unregister?: () => void };
export type NativeBrowser = {
  LoadURL: (url: string) => void;
  Destroy: () => void;
  m_refKeyboard?: { ShowVirtualKeyboard: () => void; SetAsCurrentVirtualKeyboardTarget?: () => void };
  m_browserView: {
    SetFocus: (focused: boolean) => void;
    GetBounds?: () => { x: number; y: number; width: number; height: number } | undefined;
    SetBounds?: (x: number, y: number, width: number, height: number) => void;
  };
};
export type ControllerState = { unControllerIndex: number; ulButtons: number; ulUpperButtons: number };
export type Game = { appid: string; name: string };
export const steam = window as Window & {
  SteamUIStore?: {
    SetRunningApp: (appid: number) => void;
    NavigateToRunningApp?: (force: boolean) => void;
  };
  SteamClient?: {
    Input?: {
      RegisterForControllerInputMessages?: (callback: (index: number, button: number, pressed: boolean) => void) => Registration;
      RegisterForControllerStateChanges?: (callback: (changes: ControllerState[]) => void) => Registration;
      ControllerKeyboardSetKeyState?: (key: number, pressed: boolean) => void;
    };
    System?: { OpenVirtualKeyboard?: () => void };
  };
};

export function drop(registration?: Registration) {
  (registration?.unregister ?? registration?.Unregister)?.call(registration);
}
