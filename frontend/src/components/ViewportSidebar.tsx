import { usePipelineStore, PHI_SYMMETRY_PRESETS, type PhiSymmetry } from "@/stores/pipelineStore";
import { GoalPicker } from "./GoalPicker";

// Render/press-config panel, left of the mesh viewport -- collapse/resize
// is now handled by the wrapping <Panel> (react-resizable-panels: drag to
// its minimum, or a collapse control the caller wires up), not an
// internal width-toggle here -- a hand-rolled collapsed-width div would
// fight with the Panel's own drag-computed width. Holds every rendering/
// press-config control that used to live scattered across the top toolbar
// (press preview, billet opacity, goal picker) plus the physical-press-
// limit toggle (previously a per-node param, see NodeInspector's filter)
// and a default-press-geometry picker -- pulled out specifically because
// the toolbar was getting crowded (direct ask: "top ribbon/banner is
// getting quite busy").
export function ViewportSidebar() {
  const {
    showPressPreview, setShowPressPreview,
    billetOpacity, setBilletOpacity,
    nodeKinds, defaultTool, setDefaultTool,
    forceCorrectClosure, setForceCorrectClosure,
    phiSymmetry, setPhiSymmetry,
    meshField, setMeshField, availableFields,
    fieldRangeLocked, setFieldRangeLocked, fieldMin, fieldMax, setFieldRange,
    showTools, setShowTools,
  } = usePipelineStore();

  // Whichever registered node kind's schema has a "tool" param first --
  // detected by presence, not hardcoded to "slab_strike" by name, same
  // convention used elsewhere (e.g. PipelineView's previewOverlay).
  const toolOptions = nodeKinds.find((k) => k.params.tool)?.params.tool.options ?? [];

  return (
    <div className="h-full w-full flex flex-col overflow-y-auto">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border text-xs text-gray-400 shrink-0">
        <span className="font-semibold uppercase tracking-wide text-[10px]">Render settings</span>
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

        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1">
            <span>Color by field</span>
            <select
              value={meshField}
              onChange={(e) => setMeshField(e.target.value)}
              className="bg-surface border border-border rounded px-1.5 py-1 text-gray-200 w-full"
            >
              <option value="none">none (material color)</option>
              {availableFields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <label
            className="flex items-center gap-1.5 cursor-pointer select-none"
            title="Off: the color range fits whichever mesh is shown. On: a fixed range, so colors compare across steps."
          >
            <input
              type="checkbox"
              checked={fieldRangeLocked}
              onChange={(e) => setFieldRangeLocked(e.target.checked)}
              className="accent-accent"
            />
            <span>Lock range</span>
          </label>
          {fieldRangeLocked && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={fieldMin}
                onChange={(e) => setFieldRange(Number(e.target.value), fieldMax)}
                className="bg-surface border border-border rounded px-1 py-0.5 text-gray-200 w-full tabular-nums"
              />
              <span className="text-gray-600">to</span>
              <input
                type="number"
                value={fieldMax}
                onChange={(e) => setFieldRange(fieldMin, Number(e.target.value))}
                className="bg-surface border border-border rounded px-1 py-0.5 text-gray-200 w-full tabular-nums"
              />
            </div>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Dies, bend die, punch, blade, induction coil">
            <input
              type="checkbox"
              checked={showTools}
              onChange={(e) => setShowTools(e.target.checked)}
              className="accent-accent"
            />
            <span>Show tooling</span>
          </label>
        </div>

        <label className="flex flex-col gap-1 border-t border-border pt-3">
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
          <label className="flex flex-col gap-1">
            <span>Strike symmetry</span>
            <select
              value={phiSymmetry}
              onChange={(e) => setPhiSymmetry(e.target.value as PhiSymmetry)}
              className="bg-surface border border-border rounded px-1.5 py-1 text-gray-200 w-full"
            >
              {(Object.entries(PHI_SYMMETRY_PRESETS) as [PhiSymmetry, { label: string }][]).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
          <span className="text-[10px] text-gray-600">
            Constrains each strike's angle to evenly-spaced positions matching a target cross-section — each strike
            is already two-sided, so N faces only needs N/2 angles.
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
