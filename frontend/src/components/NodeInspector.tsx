import { usePipelineStore, PHI_SYMMETRY_PRESETS, phiStep, type PhiSymmetry } from "@/stores/pipelineStore";
import { ParamControl } from "./ParamControl";
import { TuningPanel } from "./TuningPanel";
import { formatRadiansAsPi } from "@/utils/angleFormat";
import { useOptimizeStore } from "@/stores/optimizeStore";

// "force_correct_closure": ViewportSidebar's "Physical press limit"
// toggle. The 4 material params: embedded TuningPanel below, shown only
// when the SELECTED node is the slab_stock root (tuning is per-chain now,
// see pipelineStore's materialParamsForRoot/setTuningProfile). Both
// rewrite every slab_strike node's own copy together, so neither belongs
// in this per-node editing view.
const GLOBALLY_CONTROLLED_PARAMS = new Set([
  "force_correct_closure", "beta", "plastic_decay_ahead_mm", "plastic_decay_behind_mm", "plastic_kernel_power",
]);

// Button labels: the number of faces (the full name is the tooltip).
// pi fractions, and a full turn reads "2π" (not back to 0) at the slider's end
const formatAngle = (v: number) => (Math.abs(v - 2 * Math.PI) < 1e-6 ? "2π" : formatRadiansAsPi(v));

const SYMMETRY_SHORT: Record<PhiSymmetry, string> = { free: "Free", square: "4", hex: "6", octagon: "8" };

export function NodeInspector() {
  const {
    nodes, nodeKinds, selectedNodeId, updateNodeParam, cooking, cookError, diagnostics, phiSymmetry, setNodeSymmetry,
    copiedNodes, copyNodes, paste,
  } = usePipelineStore();
  const node = nodes.find((n) => n.id === selectedNodeId);
  const knobs = useOptimizeStore((s) => s.knobs);
  const toggleKnob = useOptimizeStore((s) => s.toggleKnob);

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
              className="text-[10px] px-1.5 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors"
            >
              Copy
            </button>
            <button
              onClick={paste}
              disabled={!copiedNodes}
              title="Paste onto this node, or every multi-selected node (Ctrl/Cmd+V)"
              className="text-[10px] px-1.5 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-gray-100 disabled:opacity-40 disabled:hover:text-gray-300 disabled:hover:border-border transition-colors"
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
            // and dragging beats picking from a list for fast iteration).
            // The node's symmetry preset makes it snap to evenly spaced
            // stops (e.g. every pi/2 for "square"), each a labelled bullet;
            // "free" is the schema's smooth 0.01 rad step. min/max stay the
            // schema's full 0-2pi either way.
            const slider = (ticks?: number[]) => (
              <ParamControl
                key={name}
                name={name}
                spec={spec}
                value={node.data.params[name] ?? spec.default}
                onChange={(v) => updateNodeParam(node.id, name, v)}
                formatValue={name === "phi" ? formatAngle : undefined}
                ticks={ticks}
                refOptions={spec.type === "node_ref" ? nodes
                  .filter((n) => n.id !== node.id && (!spec.ref_kind || n.data.kind === spec.ref_kind))
                  .map((n) => ({ value: n.id, label: typeof n.data.params.label === "string" && n.data.params.label
                    ? n.data.params.label : n.id })) : undefined}
              />
            );
            let control = slider();
            if (name === "phi") {
              const sym = (node.data.symmetry as PhiSymmetry | undefined) ?? phiSymmetry;
              const step = phiStep(sym);
              const lo = spec.min ?? 0;
              const hi = spec.max ?? 2 * Math.PI;
              const ticks = step === null ? undefined
                : Array.from({ length: Math.floor((hi - lo) / step + 1e-6) + 1 }, (_, i) => lo + i * step);
              control = (
                <div key={name} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1 text-[10px]" title="Strike symmetry: the angles this strike snaps to (new strikes inherit the last pick). Each strike is two-sided, so N faces need N/2 angles.">
                    <span className="text-gray-500 mr-1">Symmetry</span>
                    {(Object.keys(PHI_SYMMETRY_PRESETS) as PhiSymmetry[]).map((k) => (
                      <button
                        key={k}
                        onClick={() => setNodeSymmetry(node.id, k)}
                        title={PHI_SYMMETRY_PRESETS[k].label}
                        className={`px-1.5 py-0.5 rounded border transition-colors ${
                          k === sym ? "bg-accent border-accent text-white" : "border-border text-gray-400 hover:border-accent"}`}
                      >
                        {SYMMETRY_SHORT[k]}
                      </button>
                    ))}
                  </div>
                  {slider(ticks)}
                </div>
              );
            }
            if (!spec.optimizable) return control;
            const on = knobs.some((k) => k.nodeId === node.id && k.param === name);
            return (
              <div key={name} className="flex items-start gap-1.5">
                <button
                  onClick={() => toggleKnob(node.id, name)}
                  title={on ? "A knob for the optimizer (click to remove)" : "Let the optimizer tune this param"}
                  className={`mt-0.5 w-4 h-4 shrink-0 rounded-full border text-[9px] leading-none flex items-center justify-center transition-colors ${
                    on ? "bg-accent border-accent text-white" : "border-border text-gray-500 hover:border-accent"
                  }`}
                >
                  ◎
                </button>
                <div className="flex-1 min-w-0">{control}</div>
              </div>
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
