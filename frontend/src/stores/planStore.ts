// State of the side panel's "Plan" tab: the selected goal mesh decomposed into
// the operations that make it (server: forge_genie's /api/plan/*, forge-control's
// fit -> decompose), each group with its subgoal (shown in the viewport on
// click). The plan goes into the graph as a chain of controller nodes, each
// aimed at its group's Subgoal node through its goal input -- cooking that
// chain is running the plan forward.
import { create } from "zustand";
import { usePipelineStore } from "@/stores/pipelineStore";
import { type FieldSpec, type SettingValue, TERMINAL, useSearchStore } from "@/stores/searchStore";
import { toast } from "@/stores/toastStore";
import type { GraphJson } from "@/types/pipeline";

export interface PlanLeg {
  index: number;
  op: "cog" | "slit" | "bend" | "flatten" | "pierce";
  label: string; // "Bend 2"
  chain: number;
  chain_name: string; // "root" | "prong 1"
  start: number; // shapes index: the shape it starts from ...
  end: number; // ... and the one it should make (its subgoal)
  summary: string;
  params: Record<string, unknown>;
}

export interface PlanShape { index: number; name: string; tag: string }

export interface PlanInfo {
  goal_tag: string; // the goal mesh as held (seated at the stock's grip)
  seat: { offset_mm: number; tilt_deg: number };
  held_mm: number; // the billet's sacrificial held end, behind x = 0 (0: the goal's own held end is held)
  shapes: PlanShape[];
  legs: PlanLeg[];
  notes: string[];
  // standard: the D38.1 bar, as long as the part needs (`workable_mm` past the held end, of `max_workable_mm`)
  stock: { radius: number; length: number; source: "standard" | "graph" | "preform"; why: string;
           workable_mm: number; max_workable_mm: number };
  stock_suggested: { radius: number; length: number };
  features: { holes: number; bends: number; flats: number; slit: boolean };
}

export interface PlanStatus {
  job_id: string;
  state: string;
  phase?: string | null;
  goal: string;
  iteration: number;
  iterations: number;
  tag: string;
  progress_label?: string;
  best_loss?: number;
  error?: string;
  plan?: PlanInfo;
}

// What the viewport shows for the plan: a subgoal (the shape a group makes).
// null: the graph's own view.
export type PlanView = { shape: number } | null;

const DONE_NAME: Record<PlanLeg["op"], string> = {
  cog: "straight preform", slit: "after slitting", bend: "after bending", flatten: "after flattening",
  pierce: "after piercing",
};
const GROUP_NAME: Record<PlanLeg["op"], string> = {
  cog: "Cogging", slit: "Slitting", bend: "Bending", flatten: "Flattening", pierce: "Piercing",
};

/** A group of legs of one operation, and the shape it makes (its subgoal). */
export interface PlanGroup { op: PlanLeg["op"]; label: string; shape: number; name: string; legs: number[] }

/** The plan's groups, in order: the abstraction the plan is built on (one
 *  subgoal each); the legs inside a group are its settings. Each cogging leg is
 *  a group of its own (a stretch of the bar, with its dies). Mirrors the
 *  server's /api/plan/subgoals. */
export function subgoals(plan: PlanInfo): PlanGroup[] {
  const out: PlanGroup[] = [];
  for (const lg of plan.legs) {
    const last = out[out.length - 1];
    if (last && last.shape === lg.end && lg.op !== "cog") last.legs.push(lg.index);
    else out.push({ op: lg.op, label: GROUP_NAME[lg.op], shape: lg.end, name: DONE_NAME[lg.op], legs: [lg.index] });
  }
  if (out.length) out[out.length - 1].name = "the goal";
  return out;
}

interface PlanStore {
  fields: FieldSpec[] | null;
  run: string; // the buffer run the plan's meshes are under
  settings: Record<string, SettingValue>;
  jobId: string | null;
  status: PlanStatus | null;
  error: string | null;
  view: PlanView;
  loadSchema: () => Promise<void>;
  setSetting: (name: string, value: SettingValue) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  makeGoal: (shape: number | "goal", name: string) => Promise<void>;
  // The plan in the graph: a group's subgoal as a Subgoal node (`groups`), or
  // (`chain`) a stock and a controller node per group (its operation's kind),
  // each with its subgoal's node in its goal input -- the plan as a chain of
  // controllers, each editable; the graph cooks it (runs it forward) at once.
  toGraph: (opts: { groups?: number[]; chain?: boolean }) => Promise<void>;
  setView: (v: PlanView) => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

// Polls the job's status until it ends; the first plan it sees is shown (the
// straight preform).
function poll(get: () => PlanStore, set: (p: Partial<PlanStore>) => void) {
  if (pollTimer) clearInterval(pollTimer);
  let misses = 0;
  pollTimer = setInterval(async () => {
    const id = get().jobId;
    if (!id) return;
    try {
      const r = await fetch(`/api/plan/status?job_id=${id}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const st: PlanStatus = await r.json();
      misses = 0;
      const first = !get().status?.plan && st.plan;
      set({ status: st, error: null });
      if (first && get().view === null) set({ view: { shape: 0 } });
      if (TERMINAL.includes(st.state) && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    } catch (e) {
      if (++misses >= 10) set({ error: `no status from the server for ${misses} s (${String(e)})` });
    }
  }, 1500);
}

export const usePlanStore = create<PlanStore>((set, get) => ({
  fields: null,
  run: "plan",
  settings: {},
  jobId: null,
  status: null,
  error: null,
  view: null,

  loadSchema: async () => {
    if (get().fields) return;
    try {
      const res = await fetch("/api/plan/schema");
      if (!res.ok) return; // no planning backend: the panel says so
      const data: { run: string; fields: FieldSpec[] } = await res.json();
      const defaults = Object.fromEntries(data.fields.map((f) => [f.name, f.default as SettingValue]));
      set({ fields: data.fields, run: data.run, settings: { ...defaults, ...get().settings } });
      if (get().jobId) return;
      // a fresh page: the server's latest plan, if it has one (still running: follow it)
      const r = await fetch("/api/plan/status");
      if (!r.ok) return;
      const st: PlanStatus = await r.json();
      set({ jobId: st.job_id, status: st });
      if (!TERMINAL.includes(st.state)) poll(get, set);
    } catch {
      // no planning backend
    }
  },

  setSetting: (name, value) => set((s) => ({ settings: { ...s.settings, [name]: value } })),

  start: async () => {
    const { goalName, nodes } = usePipelineStore.getState();
    const root = nodes.find((n) => n.data.kind === "ops_stock");
    set({ error: null, status: null, jobId: null, view: null });
    const res = await fetch("/api/plan/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: goalName, stock: root ? root.data.params : null, settings: get().settings }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      set({ error: `could not start (HTTP ${res.status})${data.error ? `: ${data.error}` : ""}` });
      return;
    }
    set({ jobId: data.job_id });
    poll(get, set);
  },

  stop: async () => {
    await fetch("/api/plan/stop", { method: "POST" });
  },

  makeGoal: async (shape, name) => {
    const res = await fetch("/api/plan/goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: get().jobId, shape, name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      toast({ text: `Couldn't make goal "${name}": ${data.error ?? `HTTP ${res.status}`}`, tone: "error" });
      return;
    }
    const pipeline = usePipelineStore.getState();
    await pipeline.fetchAvailableGoals();
    toast({
      text: `Goal "${data.name}": ${Math.round(data.volume_mm3).toLocaleString()} mm³, ${data.length_mm.toFixed(1)} mm long`,
      tone: "success",
      action: { label: "Use it", run: () => usePipelineStore.getState().setGoalName(data.name) },
    });
  },

  setView: (v) => set({ view: v }),

  toGraph: async ({ groups, chain }) => {
    const res = await fetch("/api/plan/subgoals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: get().jobId, groups: groups ?? null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      toast({ text: `Couldn't add the plan to the graph: ${data.error ?? `HTTP ${res.status}`}`, tone: "error" });
      return;
    }
    const subs: { id: string; name: string; op: string; kind: string; settings?: Record<string, unknown> }[] = data.subgoals;
    const nodes: { id: string; kind: string; params: Record<string, unknown> }[] = subs.map((sg, i) => ({
      id: `g${i}`, kind: "plan_subgoal", params: { subgoal: sg.id, label: sg.name },
    }));
    const edges: { source: string; target: string; target_input: string }[] = [];
    if (chain) {
      nodes.unshift({ id: "s", kind: "ops_stock", params: data.stock });
      subs.forEach((sg, i) => {
        const cogs = subs.filter((x) => x.op === "cog");
        const which = sg.op === "cog" && cogs.length > 1 ? ` ${cogs.indexOf(sg) + 1}` : "";
        nodes.push({ id: `c${i}`, kind: sg.kind,
                     params: { ...(sg.settings ?? {}), label: `${sg.op}${which} → ${sg.name.split(": ").pop()}` } });
        edges.push({ source: i === 0 ? "s" : `c${i - 1}`, target: `c${i}`, target_input: "state" });
        edges.push({ source: `g${i}`, target: `c${i}`, target_input: "goal" });
      });
    }
    const pipeline = usePipelineStore.getState();
    // a chain opens as the Search tab's results do (replacing the graph, or beside it); a lone subgoal goes beside.
    // Either way the graph cooks: the chain runs forward, controller by controller.
    pipeline.importGraph({ nodes, edges } as unknown as GraphJson,
                         { append: !chain || useSearchStore.getState().openMode === "add" });
    set({ view: null });
    toast({ text: chain ? `The plan as ${subs.length} controllers, each aimed at its subgoal: cooking`
                        : `Added: ${subs.map((s) => s.name).join(", ")}`,
            tone: "success" });
  },
}));

// Picking a node, or playing the sequence, hands the viewport back to the graph.
usePipelineStore.subscribe((s, prev) => {
  if ((s.selectedNodeId && s.selectedNodeId !== prev.selectedNodeId) || (s.viewSequence && !prev.viewSequence)) {
    if (usePlanStore.getState().view !== null) usePlanStore.getState().setView(null);
  }
});

/** The viewport's meshes for the current plan view, or null. */
export function planViewMeshes(status: PlanStatus | null, view: PlanView):
  { main: string; mainIsMade: boolean; subgoal: string | null; goal: string; caption: string } | null {
  const plan = status?.plan;
  if (!plan || view === null) return null;
  const sg = subgoals(plan).find((g) => g.shape === view.shape) ?? { shape: view.shape, name: plan.shapes[view.shape]?.name };
  const shape = plan.shapes[view.shape];
  if (!shape) return null;
  return { main: shape.tag, mainIsMade: false, subgoal: null, goal: plan.goal_tag,
           caption: `Subgoal: ${sg.name} (amber) · the goal (green)` };
}
