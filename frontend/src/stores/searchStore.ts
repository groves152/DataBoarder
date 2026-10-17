// State of the side panel's "Sequence search" tab: a search method (MAP-Elites,
// the cogging controller, ...) run toward the selected goal mesh (server:
// forge_genie's /api/search/*). The methods and each one's settings come from
// the server's schema; the panel builds each method's form from its fields.
// The status is polled while a job runs; results open as paths in the graph.
import { create } from "zustand";
import { usePipelineStore } from "@/stores/pipelineStore";
import type { PathJson } from "@/types/pipeline";

// one setting of a method (server: search_methods.base.Field)
export interface FieldSpec {
  name: string;
  label: string;
  kind: "int" | "float" | "bool" | "select" | "multiselect";
  default: unknown;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Record<string, string>; // value -> label
  count?: [number, number]; // multiselect: min, max picks
}

export interface MethodSpec {
  key: string;
  label: string;
  description: string;
  fields: FieldSpec[];
}

export interface SearchSchema {
  run: string;
  methods: MethodSpec[];
  default_method: string;
}

export type SettingValue = number | boolean | string | string[];

export interface SearchStatus {
  job_id: string;
  method: string;
  state: string; // method-specific running states, then done | stopped | error
  phase?: string | null;
  iteration: number;
  iterations: number;
  goal: string;
  tag: string;
  progress_label?: string; // what the progress chart and best_loss measure
  best_loss?: number;
  error?: string;
  // MAP-Elites
  descriptors?: string[];
  coverage?: number;
  best_polished_loss?: number | null;
  archive?: { cells: number[]; loss: number[]; descriptors: number[][] };
  polished?: { index: number; cell: number; loss: number; archive_loss: number; descriptors: number[] }[];
  // a controller: its one program
  result?: Record<string, number | boolean>;
}

interface SearchStore {
  schema: SearchSchema | null;
  method: string | null;
  settings: Record<string, Record<string, SettingValue>>; // per method: name -> value
  jobId: string | null;
  status: SearchStatus | null;
  error: string | null;
  loading: boolean; // a result is being turned into a path
  loadSchema: () => Promise<void>;
  setMethod: (key: string) => void;
  setSetting: (name: string, value: SettingValue) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  open: (which: { cell?: number; polished?: number }) => Promise<void>;
  // How a result opens: replace the graph, or add it beside what's there.
  openMode: "replace" | "add";
  setOpenMode: (m: "replace" | "add") => void;
}

export const TERMINAL = ["done", "stopped", "error"];
let pollTimer: ReturnType<typeof setInterval> | null = null;

const defaults = (m: MethodSpec) => Object.fromEntries(m.fields.map((f) => [f.name, f.default as SettingValue]));

export function methodSpec(schema: SearchSchema | null, key: string | null | undefined): MethodSpec | undefined {
  return schema?.methods.find((m) => m.key === key);
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  schema: null,
  method: null,
  settings: {},
  jobId: null,
  status: null,
  error: null,
  loading: false,

  loadSchema: async () => {
    if (get().schema) return;
    try {
      const res = await fetch("/api/search/schema");
      if (!res.ok) return; // no search backend: the panel says so
      const schema: SearchSchema = await res.json();
      const settings = Object.fromEntries(schema.methods.map((m) => [m.key, { ...defaults(m), ...get().settings[m.key] }]));
      set({ schema, settings, method: get().method ?? schema.default_method });
    } catch {
      // no search backend
    }
  },

  setMethod: (key) => set({ method: key }),

  setSetting: (name, value) =>
    set((s) => {
      const m = s.method ?? "";
      return { settings: { ...s.settings, [m]: { ...s.settings[m], [name]: value } } };
    }),

  start: async () => {
    const { goalName, nodes } = usePipelineStore.getState();
    const root = nodes.find((n) => n.data.kind === "ops_stock");
    const { method, settings } = get();
    set({ error: null, status: null, jobId: null });
    const res = await fetch("/api/search/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method,
        goal: goalName,
        stock: root ? root.data.params : null, // the graph's stock, if it has one (else the real-scale D40 x 59)
        settings: settings[method ?? ""] ?? {},
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      set({ error: `could not start (HTTP ${res.status})${data.error ? `: ${data.error}` : ""}` });
      return;
    }
    set({ jobId: data.job_id });
    if (pollTimer) clearInterval(pollTimer);
    let misses = 0;
    pollTimer = setInterval(async () => {
      const id = get().jobId;
      if (!id) return;
      try {
        const r = await fetch(`/api/search/status?job_id=${id}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const st: SearchStatus = await r.json();
        misses = 0;
        set({ status: st, error: null });
        if (TERMINAL.includes(st.state) && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch (e) {
        if (++misses >= 10) set({ error: `no status from the server for ${misses} s (${String(e)})` });
      }
    }, 1500);
  },

  stop: async () => {
    await fetch("/api/search/stop", { method: "POST" });
  },

  openMode: "replace",
  setOpenMode: (m) => set({ openMode: m }),

  open: async (which) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/search/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: get().jobId, ...which }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      usePipelineStore.getState().loadPath(data.path as PathJson, { append: get().openMode === "add" });
    } catch (e) {
      set({ error: `could not open the result: ${String(e)}` });
    } finally {
      set({ loading: false });
    }
  },
}));
