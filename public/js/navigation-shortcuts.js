document.addEventListener("keydown", event => {
  if (
    !event.shiftKey ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.repeat ||
    event.isComposing
  ) return;

  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select") || target.isContentEditable)
  ) return;

  const routes = {
    Digit1: "/dashboard",
    Digit2: "/pos",
    Digit3: "/medicines",
    Digit4: "/categories",
    Digit5: "/suppliers",
    Digit6: "/inventory",
    Digit7: "/transactions",
    Digit8: "/reports",
    Digit9: "/users",
    Digit0: "/settings"
  };
  const path = routes[event.code];
  if (!path) return;

  const link = document.querySelector(`.sidebar nav a[href="${path}"]`);
  if (!link) return;

  event.preventDefault();
  link.click();
});
