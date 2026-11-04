(origin, selectors, action, image, expectedPath) => {
  if (location.origin !== origin) return null;
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (expectedPath && path !== expectedPath) return null;
  const visible = (element) => element.getClientRects().length > 0;
  const find = (selector) => [...document.querySelectorAll(selector)].find(visible);
  const loginForm = !!find('input[type="password"], input[autocomplete="username"], input[autocomplete="one-time-code"]');
  const composer = find(selectors.composer);
  const send = find(selectors.send);
  const form = composer?.closest("form") ?? composer?.parentElement?.parentElement;
  const attachment = !!composer && [form, composer.closest("rich-textarea")?.parentElement,
    composer.parentElement?.parentElement?.parentElement].some(scope =>
    scope && [...scope.querySelectorAll(selectors.attachment)].some(visible));
  const select = (key) => !!find(selectors[key]);
  const draft = (composer?.value ?? composer?.textContent ?? "").trim();
  const enabled = !!send && !send.disabled && send.getAttribute("aria-disabled") !== "true";
  switch (action) {
    case "state":
      return {
        path, composer: !!composer, login: loginForm || select("login"),
        attachment, draft,
        busy: select("busy"),
        enabled,
        messages: document.querySelectorAll(selectors.user).length,
      };
    case "paste": {
      if (!composer || loginForm || select("login")) return false;
      const bytes = Uint8Array.from(atob(image), (character) => character.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "aideck-screenshot.png", { type: "image/png" }));
      composer.focus();
      composer.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      return true;
    }
    case "focus":
      if (loginForm || document.activeElement?.matches('input, textarea, [contenteditable="true"]')) return true;
      composer?.focus();
      return !!composer;
    case "focusComposer":
      if (!composer || loginForm || select("login")) return false;
      composer.focus();
      return document.activeElement === composer || composer.contains(document.activeElement);
    case "send":
      if (!enabled || !draft || !attachment || loginForm || select("login") || select("busy")) return false;
      send.click();
      return true;
  }
}
