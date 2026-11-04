(selectors, action, image, expectedPath) => {
  if (location.origin !== "https://chatgpt.com") return null;
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (expectedPath && path !== expectedPath) return null;
  const composer = document.querySelector(selectors.composer);
  const send = document.querySelector(selectors.send);
  const form = composer?.closest("form") ?? composer?.parentElement?.parentElement;
  const select = (key) => !!document.querySelector(selectors[key]);
  switch (action) {
    case "state":
      return {
        path, composer: !!composer, login: select("login"),
        attachment: !!form?.querySelector(selectors.attachment),
        draft: composer?.textContent?.trim() || "",
        busy: select("busy"),
        enabled: !!send && !send.disabled && send.getAttribute("aria-disabled") !== "true",
        messages: document.querySelectorAll(selectors.user).length,
      };
    case "paste": {
      if (!composer) return false;
      const bytes = Uint8Array.from(atob(image), (character) => character.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "spiel.png", { type: "image/png" }));
      composer.focus();
      composer.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      return true;
    }
    case "focus":
      composer?.focus();
      return !!composer;
    case "send":
      if (!send || send.disabled || send.getAttribute("aria-disabled") === "true") return false;
      send.click();
      return true;
  }
}
