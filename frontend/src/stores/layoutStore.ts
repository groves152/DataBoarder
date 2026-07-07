import { create } from "zustand";
import type { Layout } from "react-grid-layout";
import type { MergeMode, PanelLayout } from "@/types";

/** Find the first (x,y) position that doesn't overlap any existing panel. */
export function findFreePosition(
  panels: PanelLayout[],
  w: number,
  h: number,
  cols = 12,
): { x: number; y: number } {
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const conflict = panels.some(
        (p) =>
          x < p.x + p.w && x + w > p.x &&
          y < p.y + p.h && y + h > p.y,
      );
      if (!conflict) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function inferMergeMode(a: PanelLayout, b: PanelLayout): MergeMode {
  const allScalar = [...a.sources, ...b.sources].every(
    (s) => s.type === "scalar" || s.type === "scalars",
  );
  return allScalar ? "overlay" : "split";
}

interface LayoutStore {
  panels: PanelLayout[];
  addPanel: (panel: PanelLayout) => void;
  removeSource: (panelId: string, tag: string, run: string) => void;
  updateGridLayout: (layout: Layout[]) => void;
  merge: (idA: string, idB: string) => void;
  setMergeMode: (panelId: string, mode: MergeMode) => void;
}

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  panels: [],

  addPanel: (panel) => set((s) => ({ panels: [...s.panels, panel] })),

  removeSource: (panelId, tag, run) =>
    set((s) => {
      const panel = s.panels.find((p) => p.i === panelId);
      if (!panel) return s;
      const remaining = panel.sources.filter((src) => !(src.tag === tag && src.run === run));
      if (remaining.length === 0)
        return { panels: s.panels.filter((p) => p.i !== panelId) };
      return { panels: s.panels.map((p) => p.i === panelId ? { ...p, sources: remaining } : p) };
    }),

  updateGridLayout: (layout) =>
    set((s) => ({
      panels: s.panels.map((p) => {
        const l = layout.find((l) => l.i === p.i);
        return l ? { ...p, x: l.x, y: l.y, w: l.w, h: l.h } : p;
      }),
    })),

  merge: (idA, idB) => {
    const { panels } = get();
    const a = panels.find((p) => p.i === idA);
    const b = panels.find((p) => p.i === idB);
    if (!a || !b) return;
    const merged: PanelLayout = {
      i: `merged-${Date.now()}`,
      // Keep the position/size of the first-selected panel
      x: a.x, y: a.y, w: a.w, h: a.h,
      sources: [...a.sources, ...b.sources],
      mergeMode: inferMergeMode(a, b),
    };
    set((s) => ({
      panels: [...s.panels.filter((p) => p.i !== idA && p.i !== idB), merged],
    }));
  },

  setMergeMode: (panelId, mode) =>
    set((s) => ({
      panels: s.panels.map((p) => p.i === panelId ? { ...p, mergeMode: mode } : p),
    })),
}));
