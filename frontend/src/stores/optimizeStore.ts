// State of the side panel's "Optimize" tab: which node params are knobs,
// which objectives (with weights) to minimize, run settings, and the running
// job (polled). The server (forge_genie's /api/optimize/*) does the work; this
// store only builds the request from the current linear chain and applies the
// best knobs back onto the nodes.
//
// A SESSION is a series of runs on one objective: the first run fixes each
// term's normalization (its value at the session's start) and the chart, and
// every later run ("Continue", typically after "Apply best") reuses both, so
// its loss reads on the same scale and its curve extends the same chart. The
// objectives are locked while a session lasts; "New session" unlocks them.
import { create } from "zustand";
import { linearChain, usePipelineStore } from "@/stores/pipelineStore";
import type { ParamValue, PathJson } from "@/types/pipeline";

export interface KnobRef { nodeId: string; param: string }

export interface Objective { on: boolean; weight: number }

export interface OptimizeSettings {
  strategy: "auto" | "gd"; // auto: multi-start rollouts + successive halving, then refine
  iterations: number; // loss + gradient evaluations in all
  lr: number;
  schedule: "cosine" | "constant";
  resolution: "fast" | "medium" | "full";
  temperature: "frozen" | "coupled";
  refreshEvery: number;
  candidates: number;
  spread: number;
}

export interface OptimizeStatus {
  job_id: string;
  state: string; // simulating | compiling | running | refining | refreshing temperatures | verifying | done | stopped | error
  phase?: string;
  iteration: number;
  iterations: number;
  strategy?: string;
  terms0?: Record<string, number>;
  total0?: number; // the weighted total at this run's start (session normalization)
  scales?: Record<string, number>;
  best_total?: number;
  best_iteration?: number;
  best_terms?: Record<string, number>;
  best_knobs?: { index: number; param: string; value: number; start: number }[];
  sensitivity?: { index: number; param: string; effect: number }[];
  candidates?: { id: number; lr: number; best: number | null; alive: boolean }[];
  infeasible_evals?: number;
  chosen_lr?: number;
  seconds_per_iter?: number | null;
  first_iteration_s?: number;
  elapsed_s?: number;
  infeasible_steps?: string[];
  error?: string;
}

export interface Session {
  tag: string; // the chart every run of the session streams to
  objectives: Record<string, Objective>; // locked
  goal: string | null;
  scales: Record<string, number> | null; // from the first run
  startTotal: number | null; // the first run's starting total
  evals: number; // evaluations so far (the next run's x offset)
  runs: number;
}

export const OBJECTIVE_LABELS: Record<string, string> = {
  shape: "Match the goal mesh",
  features: "Hit the challenge's feature targets",
  roughness: "Smooth profile (low curvature)",
  load: "Low peak press load",
};

export const WEIGHT_MIN = 1e-3;
export const WEIGHT_MAX = 1;

// A preset a path can carry in `metadata.optimize` (the demos): knobs by step
// position in the path, objective weights, settings, a goal mesh.
interface OptimizePreset {
  knobs?: { index: number; param: string }[];
  objectives?: Record<string, number>;
  settings?: Partial<OptimizeSettings>;
  goal?: string;
}

interface OptimizeStore {
  knobs: KnobRef[];
  objectives: Record<string, Objective>;
  settings: OptimizeSettings;
  session: Session | null;
  jobId: string | null;
  status: OptimizeStatus | null;
  error: string | null;
  original: Record<string, Record<string, ParamValue>> | null; // knob values before "Apply best"
  isKnob: (nodeId: string, param: string) => boolean;
  toggleKnob: (nodeId: string, param: string) => void;
  toggleAllOn: (nodeIds: string[]) => void;
  clearKnobs: () => void;
  setObjective: (id: string, o: Partial<Objective>) => void;
  setSettings: (s: Partial<OptimizeSettings>) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  newSession: () => void;
  applyBest: () => void;
  revert: () => void;
}

const DEFAULT_SETTINGS: OptimizeSettings = {
  strategy: "auto", iterations: 120, lr: 0.05, schedule: "cosine", resolution: "fast", temperature: "frozen",
  refreshEvery: 25, candidates: 6, spread: 0.15,
};

const DEFAULT_OBJECTIVES: Record<string, Objective> = {
  shape: { on: false, weight: 1 }, features: { on: true, weight: 1 }, roughness: { on: false, weight: 1 },
  load: { on: false, weight: 1 },
};

const TERMINAL = ["done", "stopped", "error"];

let pollTimer: ReturnType<typeof setInterval> | null = null;

function chainIds(): string[] | null {
  const { nodes, edges } = usePipelineStore.getState();
  return linearChain(nodes, edges);
}

export function clampWeight(w: number): number {
  return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w));
}

// What the panel shows as active: on, and available (the shape term needs a
// goal, the feature term a challenge path).
export function activeWeights(objectives: Record<string, Objective>, goal: string | null,
                              challenge: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(objectives)
    .filter(([id, o]) => o.on && (id !== "shape" || !!goal) && (id !== "features" || !!challenge))
    .map(([id, o]) => [id, clampWeight(o.weight)]));
}

export const useOptimizeStore = create<OptimizeStore>((set, get) => ({
  knobs: [],
  objectives: DEFAULT_OBJECTIVES,
  settings: DEFAULT_SETTINGS,
  session: null,
  jobId: null,
  status: null,
  error: null,
  original: null,

  isKnob: (nodeId, param) => get().knobs.some((k) => k.nodeId === nodeId && k.param === param),
  toggleKnob: (nodeId, param) =>
    set((s) => ({
      knobs: s.knobs.some((k) => k.nodeId === nodeId && k.param === param)
        ? s.knobs.filter((k) => !(k.nodeId === nodeId && k.param === param))
        : [...s.knobs, { nodeId, param }],
    })),
  toggleAllOn: (nodeIds) => {
    const { nodes, nodeKinds } = usePipelineStore.getState();
    const add: KnobRef[] = [];
    for (const id of nodeIds) {
      const node = nodes.find((n) => n.id === id);
      const schema = nodeKinds.find((k) => k.kind === node?.data.kind);
      for (const [param, spec] of Object.entries(schema?.params ?? {})) {
        if (spec.optimizable && !get().isKnob(id, param)) add.push({ nodeId: id, param });
      }
    }
    set((s) => ({ knobs: [...s.knobs, ...add] }));
  },
  clearKnobs: () => set({ knobs: [] }),
  setObjective: (id, o) => set((s) => (s.session ? {} : {  // locked while a session lasts
    objectives: { ...s.objectives, [id]: { ...(s.objectives[id] ?? { on: false, weight: 1 }), ...o } },
  })),
  setSettings: (part) => set((s) => ({ settings: { ...s.settings, ...part } })),

  start: async () => {
    const chain = chainIds();
    const path: PathJson | null = usePipelineStore.getState().exportPath();
    if (!chain || !path) {
      set({ error: "The graph must be a single linear chain to optimize." });
      return;
    }
    const index = new Map(chain.slice(1).map((id, i) => [id, i]));
    const knobs = get().knobs.filter((k) => index.has(k.nodeId)).map((k) => ({ index: index.get(k.nodeId)!, param: k.param }));
    const { settings } = get();
    const { goalName, pathMetadata } = usePipelineStore.getState();
    let session = get().session;
    if (!session) {
      session = {
        tag: `optimize/${Math.random().toString(36).slice(2, 10)}/loss`, objectives: get().objectives,
        goal: goalName, scales: null, startTotal: null, evals: 0, runs: 0,
      };
    }
    const weights = activeWeights(session.objectives, session.goal, pathMetadata?.challenge);
    set({ error: null, status: null, jobId: null, session });
    const res = await fetch("/api/optimize/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path, knobs, objectives: weights, goal: session.goal, tag: session.tag, step_offset: session.evals,
        ...(session.scales ? { scales: session.scales } : {}),
        seed: session.runs,
        settings: {
          strategy: settings.strategy, iterations: settings.iterations, lr: settings.lr, schedule: settings.schedule,
          resolution: settings.resolution, temperature: settings.temperature, refresh_every: settings.refreshEvery,
          candidates: settings.candidates, spread: settings.spread,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const detail = data.error ?? (data.detail ? JSON.stringify(data.detail) : null);
      set({ error: `could not start (HTTP ${res.status})${detail ? `: ${detail}` : ""}` });
      if (!get().session?.runs) set({ session: null }); // nothing ran: no session yet
      return;
    }
    set({ jobId: data.job_id });
    if (pollTimer) clearInterval(pollTimer);
    let misses = 0;
    pollTimer = setInterval(async () => {
      const id = get().jobId;
      if (!id) return;
      try {
        const r = await fetch(`/api/optimize/status?job_id=${id}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const st: OptimizeStatus = await r.json();
        misses = 0;
        const s = get().session;
        const patch: Partial<OptimizeStore> = { status: st, error: null };
        if (s && st.scales && !s.scales) {
          patch.session = { ...s, scales: st.scales, startTotal: st.total0 ?? null };
        }
        if (TERMINAL.includes(st.state)) {
          if (pollTimer) clearInterval(pollTimer);
          pollTimer = null;
          const cur = (patch.session as Session | undefined) ?? s;
          if (cur && st.state !== "error") patch.session = { ...cur, evals: cur.evals + st.iteration, runs: cur.runs + 1 };
          // the step size the search settled on carries into the next run's settings
          if (st.strategy === "auto" && typeof st.chosen_lr === "number") {
            patch.settings = { ...get().settings, lr: Number(st.chosen_lr.toPrecision(3)) };
          }
        }
        set(patch);
      } catch (e) {
        // a busy server misses a tick now and then; say so if it keeps missing
        if (++misses >= 10) set({ error: `no status from the server for ${misses} s (${String(e)})` });
      }
    }, 1000);
  },

  stop: async () => {
    await fetch("/api/optimize/stop", { method: "POST" });
  },

  newSession: () => set({ session: null, status: null, jobId: null, error: null }),

  applyBest: () => {
    const best = get().status?.best_knobs;
    const chain = chainIds();
    if (!best || !chain) return;
    const { nodes, updateNodeParam } = usePipelineStore.getState();
    const original: Record<string, Record<string, ParamValue>> = {};
    for (const k of best) {
      const id = chain[k.index + 1];
      const node = nodes.find((n) => n.id === id);
      if (!node) continue;
      original[id] = { ...(original[id] ?? {}), [k.param]: node.data.params[k.param] };
      updateNodeParam(id, k.param, Number(k.value.toFixed(4)));
    }
    set({ original });
  },

  revert: () => {
    const original = get().original;
    if (!original) return;
    const { updateNodeParam } = usePipelineStore.getState();
    for (const [id, params] of Object.entries(original)) {
      for (const [param, value] of Object.entries(params)) updateNodeParam(id, param, value);
    }
    set({ original: null });
  },
}));

// A loaded path may carry an optimizer preset (the demos): map its step
// positions onto the freshly created node ids. A new path starts a new session.
usePipelineStore.subscribe((s, prev) => {
  if (s.pathMetadata === prev.pathMetadata) return;
  const preset = (s.pathMetadata?.optimize ?? null) as OptimizePreset | null;
  if (!preset) return;
  const chain = linearChain(s.nodes, s.edges);
  if (!chain) return;
  if (preset.goal) usePipelineStore.setState({ goalName: preset.goal }); // the path's own cook picks it up
  const objectives = Object.fromEntries(Object.keys(OBJECTIVE_LABELS).map((id) => {
    const w = preset.objectives?.[id] ?? 0;
    return [id, { on: w > 0, weight: w > 0 ? clampWeight(w) : 1 }];
  }));
  useOptimizeStore.setState((o) => ({
    knobs: (preset.knobs ?? []).filter((k) => chain[k.index + 1]).map((k) => ({ nodeId: chain[k.index + 1], param: k.param })),
    objectives,
    settings: { ...DEFAULT_SETTINGS, ...o.settings, ...(preset.settings ?? {}) },
    session: null, status: null, jobId: null, error: null, original: null,
  }));
});
