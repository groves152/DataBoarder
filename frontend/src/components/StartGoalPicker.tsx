import { useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { toast } from "@/stores/toastStore";

// Sidebar widget (see ViewportSidebar): where a program starts (the stock
// node(s) in the graph, or a button to add one) and where it should end up
// (a target/goal mesh, see ui_nodes/targets.py). The goal also drives the
// per-strike reward diagnostics via cook()'s `context` payload, and shows in
// the viewport even when no node is selected (or the graph is empty). Goals
// can also be made here: an uploaded mesh file, or the selected cooked part
// (the end of one leg, to aim the next at) -- forge-genie's goals.py.

type GoalForm = { kind: "upload"; file: File; name: string; units: string }
  | { kind: "node"; node: string; name: string };
const UNITS: [string, string][] = [["mm", "mm"], ["cm", "cm"], ["m", "m"], ["inch", "inches"]];
const safeName = (s: string) => s.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64) || "goal";
const smallBtn = "px-1.5 py-0.5 rounded border border-border text-[11px] text-gray-300 hover:border-accent hover:text-gray-100 transition-colors disabled:opacity-40";
export function StartGoalPicker() {
  const {
    nodes, nodeKinds, selectedNodeId, selectNode, addNode, run, tag,
    availableGoals, fetchAvailableGoals, goalName, setGoalName, goalVisible, setGoalVisible, goalOpacity,
    setGoalOpacity, setGoalEditing,
  } = usePipelineStore();

  const [userGoals, setUserGoals] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<GoalForm | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshGoals = async () => {
    await fetchAvailableGoals();
    try {
      const res = await fetch("/api/forge/goals");
      if (res.ok) setUserGoals(new Set(((await res.json()).goals as { name: string; user: boolean }[]).filter((g) => g.user).map((g) => g.name)));
    } catch { /* no goal routes on this server */ }
  };
  useEffect(() => {
    void refreshGoals();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = nodes.find((n) => n.id === selectedNodeId);
  const submit = async () => {
    if (!form) return;
    const res = form.kind === "upload"
      ? await fetch(`/api/forge/goals/${encodeURIComponent(form.name)}?` + new URLSearchParams({
          filename: form.file.name,
          // as the file has it, the grip (low-x) end at the origin: the editor (opened next) does the rest
          transform: JSON.stringify({ units: form.units, place: "grip_origin" }) }), { method: "PUT", body: form.file })
      : await fetch("/api/forge/goals/from_node", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.name, node: form.node, run, tag }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      toast({ text: `Couldn't make goal "${form.name}": ${data.error ?? `HTTP ${res.status}`}`, tone: "error" });
      return;
    }
    // forging keeps volume: say how the goal compares with the stock in view
    const stock = stocks[0]?.data.params;
    const stockVol = stock && typeof stock.radius === "number" && typeof stock.length === "number"
      ? Math.PI * stock.radius ** 2 * stock.length : null;
    toast({ text: `Goal "${data.name}": ${Math.round(data.volume_mm3).toLocaleString()} mm³, ${data.length_mm.toFixed(1)} mm long` +
                  (stockVol ? ` (${(data.volume_mm3 / stockVol).toFixed(2)}× the stock's volume)` : ""), tone: "success" });
    const uploaded = form.kind === "upload";
    setForm(null);
    await refreshGoals();
    setGoalName(data.name);
    if (uploaded) setGoalEditing(data.name); // check its size and orientation
  };
  const removeGoal = async () => {
    if (!goalName || !window.confirm(`Delete your goal "${goalName}"?`)) return;
    await fetch(`/api/forge/goals/${encodeURIComponent(goalName)}`, { method: "DELETE" });
    setGoalName(null);
    await refreshGoals();
  };

  const stockKinds = nodeKinds.filter((k) => k.category === "stock").map((k) => k.kind);
  const stocks = nodes.filter((n) => stockKinds.includes(n.data.kind));
  const dims = (p: Record<string, unknown>) =>
    typeof p.radius === "number" && typeof p.length === "number" ? `D${2 * p.radius} × ${p.length} mm` : "";

  return (
    <div className="flex flex-col gap-1.5 text-xs text-gray-400">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">Start</span>
      {stocks.map((n) => (
        <button key={n.id} onClick={() => selectNode(n.id)} title="Select this stock node (edit it in the inspector)"
                className={`flex items-baseline justify-between gap-2 px-1.5 py-1 rounded border text-left transition-colors ${
                  n.id === selectedNodeId ? "border-accent text-gray-100" : "border-border text-gray-300 hover:border-accent"}`}>
          <span className="truncate">{typeof n.data.params.label === "string" && n.data.params.label ? n.data.params.label : n.id}</span>
          <span className="shrink-0 text-[10px] text-gray-500 tabular-nums">{dims(n.data.params)}</span>
        </button>
      ))}
      {stocks.length === 0 && stockKinds.length > 0 && (
        <button onClick={() => addNode(stockKinds[0], { x: 80, y: 80 })}
                title="Add a stock node to the graph (edit its size in the inspector)"
                className="px-1.5 py-1 rounded border border-dashed border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors">
          + Add stock
        </button>
      )}

      <span className="text-[10px] uppercase tracking-wide text-gray-500 mt-2">Goal</span>
      <select
        value={goalName ?? ""}
        onChange={(e) => setGoalName(e.target.value || null)}
        className="bg-surface border border-border rounded px-1.5 py-1 text-gray-200 w-full"
      >
        <option value="">none</option>
        {availableGoals.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1">
        <button className={smallBtn} onClick={() => fileRef.current?.click()} title="A mesh file (STL, OBJ, PLY...) as a new goal">
          Upload…
        </button>
        <button className={smallBtn} disabled={!selected?.data.cooked}
                title="The selected node's cooked part as a new goal (e.g. the end of one leg, to aim the next at)"
                onClick={() => selected && setForm({ kind: "node", node: selected.id, name: safeName(
                  `${typeof selected.data.params.label === "string" && selected.data.params.label ? selected.data.params.label : selected.id}_goal`) })}>
          From part
        </button>
        <button className={smallBtn} disabled={!goalName} onClick={() => goalName && setGoalEditing(goalName)}
                title="Scale, turn and place the goal mesh (a library goal is saved as a copy of yours)">
          Edit…
        </button>
        <button className={smallBtn} disabled={!goalName || !userGoals.has(goalName)} onClick={() => void removeGoal()}
                title="Delete this goal (only goals made here)">
          Delete
        </button>
        <input ref={fileRef} type="file" className="hidden" accept=".stl,.obj,.ply,.off,.vtk,.vtu"
               onChange={(e) => {
                 const file = e.target.files?.[0];
                 e.target.value = "";
                 if (file) setForm({ kind: "upload", file, name: safeName(file.name), units: "mm" });
               }} />
      </div>
      {form && (
        <div className="flex flex-col gap-1.5 p-2 rounded border border-border bg-surface">
          <span className="text-[10px] text-gray-500">
            {form.kind === "upload" ? `New goal from ${form.file.name}` : `New goal from ${form.node}'s part`}
          </span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Goal name"
                 className="bg-panel border border-border rounded px-1.5 py-0.5 text-gray-200" />
          {form.kind === "upload" && (
            <label className="flex items-center gap-2" title="What one unit in the file is (most CAD exports: mm). Size, orientation and placement can be set next.">
              <span>file units</span>
              <select value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} aria-label="Units"
                      className="bg-panel border border-border rounded px-1 py-0.5 text-gray-200">
                {UNITS.map(([u, label]) => <option key={u} value={u}>{label}</option>)}
              </select>
            </label>
          )}
          <div className="flex gap-1">
            <button className={smallBtn} onClick={() => void submit()}>Make goal</button>
            <button className={smallBtn} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={goalVisible}
          onChange={(e) => setGoalVisible(e.target.checked)}
          disabled={!goalName}
          className="accent-accent"
        />
        <span>Show goal</span>
      </label>
      <label className="flex flex-col gap-1">
        <span>Goal opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={goalOpacity}
          onChange={(e) => setGoalOpacity(Number(e.target.value))}
          disabled={!goalName}
          className="w-full accent-accent"
        />
      </label>
    </div>
  );
}
