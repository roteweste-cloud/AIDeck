(() => {
  if (window !== window.top || location.origin !== "https://chatgpt.com") return;

  function applyDarkMode() {
    const root = document.documentElement;
    root.classList.remove("light");
    root.classList.add("dark");
    if (root.style.colorScheme !== "dark") root.style.colorScheme = "dark";
    if (root.hasAttribute("data-theme") && root.getAttribute("data-theme") !== "dark") {
      root.setAttribute("data-theme", "dark");
    }
  }

  function watchRoot() {
    applyDarkMode();
    // ChatGPT may restore a previously selected light theme during hydration.
    new MutationObserver(applyDarkMode).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
  }

  if (document.documentElement) {
    watchRoot();
  } else {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      observer.disconnect();
      watchRoot();
    });
    observer.observe(document, { childList: true });
  }
})();
