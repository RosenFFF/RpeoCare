"use client";

import { Moon, Sun } from "lucide-react";
import type { Theme } from "@/lib/appearance";

export function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const dark = theme === "dark";
  const label = dark ? "切换到白天模式" : "切换到夜晚模式";
  return <button type="button" className="icon-button theme-toggle" aria-label={label} title={label} onClick={() => onChange(dark ? "light" : "dark")}>
    {dark ? <Sun size={18} strokeWidth={1.7} /> : <Moon size={18} strokeWidth={1.7} />}
  </button>;
}
