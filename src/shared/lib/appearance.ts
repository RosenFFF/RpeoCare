export const APPEARANCE_KEY = "openbridge.appearance.v1";

export type Theme = "light" | "dark";
export type Appearance = { theme: Theme; sidebarCollapsed: boolean };
export const defaultAppearance: Appearance = { theme: "light", sidebarCollapsed: false };

export function readAppearance(): Appearance {
  try {
    const stored = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "null");
    return {
      theme: stored?.theme === "dark" ? "dark" : "light",
      sidebarCollapsed: stored?.sidebarCollapsed === true,
    };
  } catch { return defaultAppearance; }
}

export function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.theme = appearance.theme;
  document.documentElement.dataset.sidebarCollapsed = String(appearance.sidebarCollapsed);
}

// Apply saved colors and sidebar width before first paint. Only validated values reach the DOM.
export const appearanceBootstrap = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})||'null');var d=document.documentElement;d.dataset.theme=p&&p.theme==='dark'?'dark':'light';d.dataset.sidebarCollapsed=String(!!p&&p.sidebarCollapsed===true)}catch(e){}})();`;
