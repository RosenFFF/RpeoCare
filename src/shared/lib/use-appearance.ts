"use client";

import { useEffect, useState } from "react";
import { APPEARANCE_KEY, applyAppearance, defaultAppearance, readAppearance, type Appearance } from "./appearance";

export function useAppearance() {
  const [appearance, setAppearance] = useState(defaultAppearance);

  useEffect(() => {
    const sync = () => {
      const next = readAppearance();
      applyAppearance(next);
      setAppearance(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_KEY || event.key === null) sync();
    };
    sync();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function updateAppearance(patch: Partial<Appearance>) {
    const next = { ...appearance, ...patch };
    applyAppearance(next);
    setAppearance(next);
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next)); }
    catch { /* Appearance remains usable when browser storage is unavailable. */ }
  }

  return { appearance, updateAppearance };
}
