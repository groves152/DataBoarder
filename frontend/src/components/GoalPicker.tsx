import { useEffect } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";

// Sidebar widget (see ViewportSidebar): pick a target/goal mesh (see
// ui_nodes/targets.py) to overlay against the current cooked sequence,
// toggle its visibility, and adjust its opacity. Selection lives in
// pipelineStore (not local state) since it also drives Feature 3's
// per-strike reward diagnostics via cook()'s `context` payload.
export function GoalPicker() {
  const {
    availableGoals, fetchAvailableGoals, goalName, setGoalName, goalVisible, setGoalVisible, goalOpacity,
    setGoalOpacity,
  } = usePipelineStore();

  useEffect(() => {
    fetchAvailableGoals();
  }, [fetchAvailableGoals]);

  return (
    <div className="flex flex-col gap-1.5 text-xs text-gray-400">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">Goal</span>
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
