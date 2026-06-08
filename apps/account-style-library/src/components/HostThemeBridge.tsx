"use client";

import { useEffect } from "react";

const STORAGE_KEY = "usagi_ui_style";
const SUPPORTED_THEMES = new Set(["apple", "silver", "violet", "usagi"]);

type ThemeMessage = {
  type?: unknown;
  style?: unknown;
};

export function HostThemeBridge() {
  useEffect(() => {
    applyTheme(readInitialTheme());

    function handleMessage(event: MessageEvent<ThemeMessage>) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "usagi-ui-style") return;
      applyTheme(event.data.style);
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

function readInitialTheme() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("uiStyle") || document.documentElement.dataset.uiStyle || window.localStorage.getItem(STORAGE_KEY) || "apple";
  } catch {
    return document.documentElement.dataset.uiStyle || "apple";
  }
}

function applyTheme(value: unknown) {
  const theme = normalizeTheme(value);
  document.documentElement.dataset.uiStyle = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures; the message bridge will keep the live frame synced.
  }
}

function normalizeTheme(value: unknown) {
  if (typeof value !== "string") return "apple";
  if (SUPPORTED_THEMES.has(value)) return value;
  if (value === "light") return "apple";
  if (value === "dark") return "violet";
  return "apple";
}
