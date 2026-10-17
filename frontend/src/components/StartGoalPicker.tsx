import { useEffect } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";

// Sidebar widget (see ViewportSidebar): where a program starts (the stock
// node(s) in the graph, or a button to add one) and where it should end up
// (a target/goal mesh, see ui_nodes/targets.py). The goal also drives the
// per-strike reward diagnostics via cook()'s `context` payload, and shows in
// the viewport even when no node is selected (or the graph is empty).
export function StartGoalPicker() {
  const {
    nodes, nodeKinds, selectedNodeId, selectNode, addNode,
    availableGoals, fetchAvailableGoals, goalName, setGoalName, goalVisible, setGoalVisible, goalOpacity,
    setGoalOpacity,
  } = usePipelineStore();

  useEffect(() => {
    fetchAvailableGoals();
  }, [fetchAvailableGoals]);

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
