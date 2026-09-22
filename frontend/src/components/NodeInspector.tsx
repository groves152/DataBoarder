import { usePipelineStore, PHI_SYMMETRY_PRESETS } from "@/stores/pipelineStore";
import { ParamControl } from "./ParamControl";
import { TuningPanel } from "./TuningPanel";
import { formatRadiansAsPi } from "@/utils/angleFormat";

// "force_correct_closure": ViewportSidebar's "Physical press limit"
// toggle. The 4 material params: embedded TuningPanel below, shown only
// when the SELECTED node is the slab_stock root (tuning is per-chain now,
// see pipelineStore's materialParamsForRoot/setTuningProfile). Both
// rewrite every slab_strike node's own copy together, so neither belongs
// in this per-node editing view.
const GLOBALLY_CONTROLLED_PARAMS = new Set([
  "force_correct_closure", "beta", "plastic_decay_ahead_mm", "plastic_decay_behind_mm", "plastic_kernel_power",
]);

export function NodeInspector() {
  const {
    nodes, nodeKinds, selectedNodeId, updateNodeParam, cooking, cookError, diagnostics, phiSymmetry,
    copiedNodes, copyNodes, paste,
  } = usePipelineStore();
  const node = nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-500 p-4 text-center">
        Select a node to edit its parameters.
      </div>
    );
  }

  const schema = nodeKinds.find((k) => k.kind === node.data.kind);
  const nodeDiag = diagnostics[node.id];
  const capped = Boolean(nodeDiag?.capped);

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-gray-500">{node.data.kind}</div>
            <div className="text-sm text-gray-200 font-medium">{node.id}</div>
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={copyNodes}
              title="Copy this node's params (Ctrl/Cmd+C)"
              className="text-[10px] px-1.5 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-white transition-colors"
            >
              Copy
            </button>
            <button
              onClick={paste}
              disabled={!copiedNodes}
              title="Paste onto this node, or every multi-selected node (Ctrl/Cmd+V)"
              className="text-[10px] px-1.5 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-white disabled:opacity-40 disabled:hover:text-gray-300 disabled:hover:border-border transition-colors"
            >
              Paste
            </button>
          </div>
        </div>
        <div className={`text-[10px] mt-1 ${node.data.cooked ? "text-green-400" : "text-gray-500"}`}>
          {node.data.cooked ? "cooked" : "stale — will cook shortly"}
        </div>
      </div>

      {capped && (
        <div className="px-3 py-2 border-b border-border bg-amber-950/40 text-[11px] text-amber-300">
          ⚠ Limited by physical press capacity — requested{" "}
          {typeof nodeDiag?.commanded_rho === "number" ? nodeDiag.commanded_rho.toFixed(1) : "?"}mm, achieved{" "}
          {typeof nodeDiag?.achieved_rho === "number" ? nodeDiag.achieved_rho.toFixed(1) : "?"}mm this pass. Chain
          another strike here for a second pass, or turn off "Physical press limit" in the left panel.
        </div>
      )}

      {typeof nodeDiag?.chi_reward === "number" && (
        <div
          className={`px-3 py-2 border-b border-border text-[11px] ${
            nodeDiag.chi_reward >= 0 ? "text-green-400" : "text-red-400"
          }`}
        >
          Reward vs "{String(nodeDiag.goal)}": {nodeDiag.chi_reward >= 0 ? "+" : ""}
          {(nodeDiag.chi_reward as number).toFixed(2)}
          {typeof nodeDiag.chi_overshoot_frac === "number" && nodeDiag.chi_overshoot_frac > 0.2 && (
            <span className="block text-amber-400 mt-0.5">
              ⚠ overshoot {(nodeDiag.chi_overshoot_frac * 100).toFixed(0)}% of radius
            </span>
          )}
        </div>
      )}
      {typeof nodeDiag?.chi_reward_error === "string" && (
        <div className="px-3 py-2 border-b border-border text-[11px] text-amber-400">
          Reward unavailable: {nodeDiag.chi_reward_error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-4">
        {schema && Object.entries(schema.params)
          // Controlled globally now -- "force_correct_closure" via
          // ViewportSidebar's "Physical press limit" toggle, the material
          // params via the Tuning tab -- no per-node override left for
          // any of these, so they're excluded from this generic
          // per-param render loop rather than shown as editable (but
          // actually ignored) controls here.
          .filter(([name]) => !GLOBALLY_CONTROLLED_PARAMS.has(name))
          .map(([name, spec]) => {
            // Still a SLIDER (a dropdown here was reported as "no fun,"
            // and dragging beats picking from a list for fast iteration)
            // -- a symmetry preset just overrides the slider's `step` so
            // it snaps to evenly-spaced positions (e.g. every 90deg for
            // "square") instead of the schema's normal 0.01rad step.
            // min/max stay the full 0-2pi range from the schema; only the
            // step changes, so dragging still covers the whole circle.
            const anglesDeg = PHI_SYMMETRY_PRESETS[phiSymmetry].anglesDeg;
            const effectiveSpec =
              name === "phi" && anglesDeg && anglesDeg.length > 1
                ? { ...spec, step: ((anglesDeg[1] - anglesDeg[0]) * Math.PI) / 180 }
                : spec;
            return (
              <ParamControl
                key={name}
                name={name}
                spec={effectiveSpec}
                value={node.data.params[name] ?? spec.default}
                onChange={(v) => updateNodeParam(node.id, name, v)}
                formatValue={name === "phi" ? formatRadiansAsPi : undefined}
              />
            );
          })}
        {!schema && (
          <div className="text-xs text-gray-500">Unknown node kind — no schema loaded.</div>
        )}
        {node.data.kind === "slab_stock" && (
          <div className="border-t border-border pt-4">
            <TuningPanel rootId={node.id} />
          </div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-border text-[11px]">
        {cooking && <div className="text-accent">cooking…</div>}
        {cookError && <div className="text-red-400 break-words">{cookError}</div>}
      </div>
    </div>
  );
}
