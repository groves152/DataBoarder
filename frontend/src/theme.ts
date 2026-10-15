// App theme: light / dark (or follow the OS), persisted per browser, applied as
// a class on <html> that swaps the CSS variables behind the Tailwind tokens
// (see index.css) -- plus the palette values JS-drawn things need (Plotly
// layouts, the three.js viewport).
//
// Palette: the validated data-viz reference instance (categorical order and
// steps per mode, single-hue blue sequential, blue<->red diverging with a gray
// midpoint, neutral chart chrome). Categorical slots are assigned in fixed
// order, never cycled past 8.
import { create } from "zustand";

export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "databoarder.theme";

function readStored(): ThemeMode {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "dark";
  } catch {
    return "dark";
  }
}

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function apply(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("light", resolved === "light");
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

interface ThemeStore {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (m: ThemeMode) => void;
}

export const useThemeStore = create<ThemeStore>((set) => {
  const mode = readStored();
  const resolved = mode === "system" ? systemTheme() : mode;
  apply(resolved);
  try {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      const s = useThemeStore.getState();
      if (s.mode === "system") {
        const r = systemTheme();
        apply(r);
        set({ resolved: r });
      }
    });
  } catch {
    /* no matchMedia (tests): stay on the stored mode */
  }
  return {
    mode,
    resolved,
    setMode: (m) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, m);
      } catch {
        /* private mode: the choice just isn't remembered */
      }
      const r = m === "system" ? systemTheme() : m;
      apply(r);
      set({ mode: m, resolved: r });
    },
  };
});

export const useResolvedTheme = () => useThemeStore((s) => s.resolved);

// ── palette ───────────────────────────────────────────────────────────────

export const CATEGORICAL: Record<ResolvedTheme, string[]> = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

/** Series color for slot `i` (fixed order; past 8 the caller should fold to "Other"). */
export function seriesColor(i: number, theme: ResolvedTheme): string {
  const p = CATEGORICAL[theme];
  return p[Math.min(i, p.length - 1)];
}

export const CHROME = {
  light: {
    surface: "#fcfcfb", page: "#f9f9f7", ink: "#0b0b0b", inkSecondary: "#52514e", muted: "#898781",
    grid: "#e1e0d9", baseline: "#c3c2b7", viewport: "#eceae4", part: "#7d8796",
  },
  dark: {
    surface: "#1a1a19", page: "#0d0d0d", ink: "#f0efec", inkSecondary: "#c3c2b7", muted: "#898781",
    grid: "#2c2c2a", baseline: "#383835", viewport: "#121211", part: "#9aa3b2",
  },
} as const;

/** Base Plotly layout for the current theme (merge chart-specific keys on top). */
export function plotLayout(theme: ResolvedTheme, size = 11): Record<string, unknown> {
  const c = CHROME[theme];
  const axis = { gridcolor: c.grid, zerolinecolor: c.baseline, linecolor: c.baseline, tickcolor: c.baseline };
  return {
    paper_bgcolor: c.surface,
    plot_bgcolor: c.surface,
    font: { color: c.inkSecondary, size, family: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
    colorway: CATEGORICAL[theme],
    xaxis: axis,
    yaxis: axis,
    legend: { bgcolor: "rgba(0,0,0,0)", font: { size: size - 1, color: c.inkSecondary } },
    hoverlabel: { bgcolor: c.surface, bordercolor: c.baseline, font: { color: c.ink } },
  };
}

/** Axis styling for extra axes (xaxis2, yaxis3, ...). */
export function plotAxis(theme: ResolvedTheme, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const c = CHROME[theme];
  return { gridcolor: c.grid, zerolinecolor: c.baseline, linecolor: c.baseline, tickcolor: c.baseline, ...extra };
}
