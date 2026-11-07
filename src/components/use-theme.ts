"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ResolvedTheme } from "./map/map-style";

export type ThemePreference = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "vt-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", callback);
  listeners.add(callback);
  return () => {
    media.removeEventListener("change", callback);
    listeners.delete(callback);
  };
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

const readSystemDark = () => window.matchMedia(DARK_QUERY).matches;

export function useTheme() {
  const preference = useSyncExternalStore<ThemePreference>(subscribe, readPreference, () => "system");
  const systemDark = useSyncExternalStore(subscribe, readSystemDark, () => true);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the attribute below still applies the theme.
    }
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    listeners.forEach((notify) => notify());
  }, []);

  const resolved: ResolvedTheme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  return { preference, resolved, setPreference };
}
