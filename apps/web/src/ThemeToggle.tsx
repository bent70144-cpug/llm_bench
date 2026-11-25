import { useEffect, useState } from "react";

/**
 * The light/dark theme toggle (ticket 13).
 *
 * Theme architecture: every colour in app.css is a CSS `light-dark()` token,
 * so the palette is driven entirely by the computed `color-scheme` of the
 * document element. An explicit choice is recorded as
 * `<html data-theme="light|dark">` (pinned `color-scheme`) and stored in
 * localStorage under "llm-bench-theme"; the inline no-flash script in
 * index.html applies a stored choice before first paint. Without a stored
 * choice the palette follows the OS `prefers-color-scheme` preference
 * (`:root { color-scheme: light dark }`), and this component keeps
 * following live OS changes until the visitor chooses explicitly.
 *
 * The theme is a local preference only — it is never part of the shareable
 * URL state (that is the selection/weights state, not the palette).
 */

/** The localStorage key shared with the inline no-flash script. */
const THEME_STORAGE_KEY = "llm-bench-theme";

type Theme = "light" | "dark";

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

/** The theme currently applied to the document. */
function currentTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  if (applied === "light" || applied === "dark") return applied;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    // While no explicit choice is stored, follow live OS preference changes.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (): void => {
      if (readStoredTheme() === null) setTheme(currentTheme());
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function toggleTheme(): void {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (e.g. blocked cookies): the choice still
      // applies to this page view, it just will not persist.
    }
    setTheme(next);
  }

  // aria-pressed announces the state ("toggle button, pressed/not pressed");
  // the visible label names the theme that is active.
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-pressed={theme === "dark"}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span> Theme:{" "}
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
