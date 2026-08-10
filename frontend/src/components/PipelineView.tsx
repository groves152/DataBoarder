import { useMemo, useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { GraphPanel } from "./GraphPanel";
import { NodeInspector } from "./NodeInspector";
import { MeshPanel } from "./MeshPanel";
import { PressPreview, type ToolDims } from "./PressPreview";
import { PathMenu } from "./PathMenu";
import { PlaySequenceButton } from "./PlaySequenceButton";

export function PipelineView() {
  const { run, tag, nodes, nodeKinds, setRun, setTag, selectedNodeId, cook, cooking, diagnostics } =
    usePipelineStore();
  const [showPressPreview, setShowPressPreview] = useState(true);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedSchema = nodeKinds.find((k) => k.kind === selectedNode?.data.kind);
  const selectedDiag = selectedNodeId ? diagnostics[selectedNodeId] : undefined;

  // Only meaningful for node kinds that look like a strike (have z/phi/rho
  // + a tool select param) -- generic detection off the schema rather than
  // hardcoding "slab_strike" by name, so a future pullback_strike node
  // gets this for free too as long as it uses the same param names.
  const previewOverlay = useMemo(() => {
    if (!showPressPreview || !selectedNode || !selectedSchema) return undefined;
    const p = selectedSchema.params;
    if (!p.z || !p.phi || !p.rho || !p.tool) return undefined;
    const toolName = String(selectedNode.data.params.tool ?? p.tool.default);
    const toolDims = p.tool.options_meta?.[toolName] as unknown as ToolDims | undefined;
    if (!toolDims) return undefined;

    // If the last cook reported this strike's gap was capped by the real
    // press's physical limit, snap the preview to the ACHIEVED gap instead
    // of the (impossible) requested one -- "far more clear where we will
    // actually do the strike" applies doubly once the request can't be met.
    const capped = Boolean(selectedDiag?.capped);
    const achievedRho = typeof selectedDiag?.achieved_rho === "number" ? selectedDiag.achieved_rho : undefined;
    const rho = capped && achievedRho !== undefined ? achievedRho : Number(selectedNode.data.params.rho ?? p.rho.default);

    return (
      <PressPreview
        z={Number(selectedNode.data.params.z ?? p.z.default)}
        phi={Number(selectedNode.data.params.phi ?? p.phi.default)}
        rho={rho}
        toolDims={toolDims}
        capped={capped}
      />
    );
  }, [showPressPreview, selectedNode, selectedSchema, selectedDiag]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-border bg-panel shrink-0 text-xs">
        <span className="font-semibold text-gray-400 uppercase tracking-wide mr-1">Pipeline</span>
        <span className="text-gray-500">run</span>
        <input
          value={run}
          onChange={(e) => setRun(e.target.value)}
          className="bg-surface border border-border rounded px-2 py-1 w-32 text-gray-200"
        />
        <span className="text-gray-500">tag</span>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="bg-surface border border-border rounded px-2 py-1 w-32 text-gray-200"
        />
        <button
          onClick={() => cook()}
          disabled={cooking}
          className="ml-2 px-3 py-1 rounded bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {cooking ? "Cooking…" : "Cook"}
        </button>
        <PathMenu />
        <PlaySequenceButton />
        <label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none text-gray-400">
          <input
            type="checkbox"
            checked={showPressPreview}
            onChange={(e) => setShowPressPreview(e.target.checked)}
            className="accent-accent"
          />
          <span>Press preview</span>
        </label>
        <span className="text-gray-500 ml-auto">
          Viewport shows whichever node is selected — click through a chain, or ▶ to play it once. Shift-drag or
          ctrl/cmd-click nodes to multi-select for export.
        </span>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="h-1/2 min-h-0 border-b border-border">
          {selectedNodeId ? (
            // key forces a full remount whenever the selected node changes,
            // so MeshPanel's internal frame/step state can't go stale
            // instead of reflecting the newly selected node's own data.
            <MeshPanel
              key={`${run}::${tag}::${selectedNodeId}`}
              run={run}
              tag={`${tag}/${selectedNodeId}`}
              overlay={previewOverlay}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-gray-500">
              Select a node to preview its cooked geometry (its own state, including every upstream hit applied so far).
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0">
            <GraphPanel />
          </div>
          <div className="w-72 border-l border-border shrink-0">
            <NodeInspector />
          </div>
        </div>
      </div>
    </div>
  );
}
