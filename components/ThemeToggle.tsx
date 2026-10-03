"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "glen-oaks-theme";

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const preferLight = stored === "light";
    setLight(preferLight);
    document.documentElement.classList.toggle("light", preferLight);
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    localStorage.setItem(STORAGE_KEY, next ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-full border border-app-border bg-app-surface-elevated px-4 py-2 text-sm font-medium text-app-muted transition hover:text-app-text"
    >
      {light ? "Dark mode" : "Light mode"}
    </button>
  );
}
