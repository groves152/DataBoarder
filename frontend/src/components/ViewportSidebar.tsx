import { useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { GoalPicker } from "./GoalPicker";

// Collapsible left-of-viewport panel holding every rendering/press-config
// control that used to live scattered across the top toolbar (press
// preview, billet opacity, goal picker) plus the physical-press-limit
// toggle (previously a per-node param, see NodeInspector's filter) and a
// new default-press-geometry picker -- pulled out specifically because the
// toolbar was getting crowded (direct ask: "top ribbon/banner is getting
// quite busy").
export function ViewportSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const {
    showPressPreview, setShowPressPreview,
    billetOpacity, setBilletOpacity,
    nodeKinds, defaultTool, setDefaultTool,
    forceCorrectClosure, setForceCorrectClosure,
  } = usePipelineStore();

  // Whichever registered node kind's schema has a "tool" param first --
  // detected by presence, not hardcoded to "slab_strike" by name, same
  // convention used elsewhere (e.g. PipelineView's previewOverlay).
  const toolOptions = nodeKinds.find((k) => k.params.tool)?.params.tool.options ?? [];

  if (collapsed) {
    return (
      <div className="w-7 border-r border-border shrink-0 flex flex-col items-center pt-2">
        <button
          onClick={() => setCollapsed(false)}
          title="Expand render settings"
          className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:bg-surface hover:text-white transition-colors"
        >
          »
        </button>
      </div>
    );
  }

  return (
    <div className="w-56 border-r border-border shrink-0 flex flex-col overflow-y-auto">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border text-xs text-gray-400 shrink-0">
        <span className="font-semibold uppercase tracking-wide text-[10px]">Render settings</span>
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse"
          className="ml-auto w-5 h-5 flex items-center justify-center rounded hover:bg-surface hover:text-white transition-colors"
        >
          «
        </button>
      </div>

      <div className="flex-1 px-2.5 py-3 flex flex-col gap-4 text-xs text-gray-400">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showPressPreview}
            onChange={(e) => setShowPressPreview(e.target.checked)}
            className="accent-accent"
          />
          <span>Press preview</span>
        </label>

        <label className="flex flex-col gap-1">
          <span>Billet opacity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={billetOpacity}
            onChange={(e) => setBilletOpacity(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </label>

        <div className="border-t border-border pt-3">
          <GoalPicker />
        </div>

        <div className="border-t border-border pt-3 flex flex-col gap-1.5">
          <label className="flex flex-col gap-1">
            <span>Default press geometry</span>
            <select
              value={defaultTool ?? ""}
              onChange={(e) => setDefaultTool(e.target.value)}
              disabled={toolOptions.length === 0}
              className="bg-surface border border-border rounded px-1.5 py-1 text-gray-200 w-full"
            >
              {toolOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>
          <span className="text-[10px] text-gray-600">
            Applies to newly added nodes only — each node can still override its own "Press geometry" in the inspector.
          </span>
        </div>

        <div className="border-t border-border pt-3 flex flex-col gap-1.5">
          <label
            className="flex items-center gap-1.5 cursor-pointer select-none"
            title="ON: caps every strike's achievable closure to real press capability, flagging exceeded nodes. OFF: allows arbitrary closures everywhere, no flagging."
          >
            <input
              type="checkbox"
              checked={forceCorrectClosure}
              onChange={(e) => setForceCorrectClosure(e.target.checked)}
              className="accent-accent"
            />
            <span>Physical press limit</span>
          </label>
          <span className="text-[10px] text-gray-600">
            Global — applies to every strike. Exceeded nodes get a ⚠ badge on the graph.
          </span>
        </div>
      </div>
    </div>
  );
}
