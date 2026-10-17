import { create } from "zustand";
import { graphSummary, usePipelineStore } from "@/stores/pipelineStore";
import { toast } from "@/stores/toastStore";
import type { GraphJson } from "@/types/pipeline";

// Saved graphs on the server (databoarder/library.py): save the graph or one
// program, open one (replacing the graph) or add it beside the current one.
export interface LibraryEntry {
  id: string;
  name: string;
  saved_at: string | null;
  summary: { nodes?: number; programs?: number; goal?: string | null };
}

/** Mirrors databoarder.library.entry_id. */
export function entryId(name: string): string {
  const slug = name.trim().replace(/[^A-Za-z0-9_.()-]+/g, "_").replace(/^[_.]+|[_.]+$/g, "");
  return slug.slice(0, 120) || "untitled";
}

interface LibraryStore {
  entries: LibraryEntry[];
  available: boolean; // false: this server has no library
  refresh: () => Promise<void>;
  save: (name: string, graph: GraphJson) => Promise<boolean>;
  open: (entry: LibraryEntry, mode: "replace" | "add") => Promise<void>;
  remove: (entry: LibraryEntry) => Promise<void>;
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  entries: [],
  available: true,

  refresh: async () => {
    try {
      const res = await fetch("/api/library");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ entries: (await res.json()).entries ?? [], available: true });
    } catch {
      set({ entries: [], available: false });
    }
  },

  save: async (name, graph) => {
    const res = await fetch(`/api/library/${encodeURIComponent(entryId(name))}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content: graph, summary: graphSummary(graph) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      toast({ text: `Couldn't save "${name}": ${data.error ?? `HTTP ${res.status}`}`, tone: "error" });
      return false;
    }
    toast({ text: `Saved "${name}" to the library`, tone: "success" });
    await get().refresh();
    return true;
  },

  open: async (entry, mode) => {
    const res = await fetch(`/api/library/${encodeURIComponent(entry.id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      toast({ text: `Couldn't open "${entry.name}": ${data.error ?? `HTTP ${res.status}`}`, tone: "error" });
      return;
    }
    const pipeline = usePipelineStore.getState();
    if (mode === "add") pipeline.importGraph(data.content as GraphJson, { append: true });
    else pipeline.restoreGraph(data.content as GraphJson);
    toast({ text: `${mode === "add" ? "Added" : "Opened"} "${entry.name}"`, tone: "info",
            action: { label: "Undo", run: () => usePipelineStore.getState().undo() } });
  },

  remove: async (entry) => {
    await fetch(`/api/library/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
    await get().refresh();
  },
}));
