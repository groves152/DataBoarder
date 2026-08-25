import { useEffect, useMemo, useRef } from "react";
import Plot from "react-plotly.js";
import { usePipelineStore } from "@/stores/pipelineStore";
import { ParamControl } from "./ParamControl";
import { sampleKernelProfile, KERNEL_PLOT_RANGE_MM } from "@/utils/gaussianKernel";
import { useDispatchResizeOnContainerResize } from "@/utils/useDispatchResizeOnContainerResize";

const MATERIAL_KEYS = [
  "beta", "plastic_decay_ahead_mm", "plastic_decay_behind_mm", "plastic_kernel_power",
] as const;

// New "Tuning" tab (sibling to "Graph" in PipelineView) -- lets the user
// pick a cw_slab_model tuning profile (or hand-adjust individual material
// params) and see the resulting smoothing-kernel SHAPE update live, before
// committing to a cook. Selecting a profile / dragging a slider here
// rewrites every slab_strike node's own material params globally (see
// pipelineStore's setTuningProfile/setMaterialParam) -- a chain always
// uses ONE consistent material model, matching the "physical press limit"
// toggle's existing precedent.
export function TuningPanel() {
  const {
    nodeKinds, fetchTuningProfiles, availableTuningProfiles, tuningProfileName, setTuningProfile,
    materialParams, setMaterialParam,
  } = usePipelineStore();

  useEffect(() => {
    fetchTuningProfiles();
  }, [fetchTuningProfiles]);

  const plotContainerRef = useRef<HTMLDivElement>(null);
  useDispatchResizeOnContainerResize(plotContainerRef);

  // Reuse the REAL backend-registered ParamSpecs (bounds/labels/
  // descriptions) for the 4 sliders, rather than duplicating magic
  // numbers here -- same schema slab_strike nodes already use, just
  // rendered once globally instead of once per node.
  const strikeSchema = nodeKinds.find((k) => k.params.beta)?.params;

  const { x, y, aheadHardEdge, behindHardEdge } = useMemo(
    () => sampleKernelProfile(
      materialParams.plastic_decay_ahead_mm, materialParams.plastic_decay_behind_mm,
      materialParams.plastic_kernel_power,
    ),
    [materialParams.plastic_decay_ahead_mm, materialParams.plastic_decay_behind_mm, materialParams.plastic_kernel_power],
  );

  const isCustom = tuningProfileName === "custom" || tuningProfileName === "";

  return (
    <div className="h-full w-full flex bg-surface">
      <div className="w-72 shrink-0 border-r border-border overflow-y-auto p-3 flex flex-col gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Tuning profile</div>
          <select
            value={isCustom ? "custom" : tuningProfileName}
            onChange={(e) => { if (e.target.value !== "custom") setTuningProfile(e.target.value); }}
            className="w-full bg-panel border border-border rounded px-2 py-1.5 text-xs text-gray-200"
          >
            {isCustom && <option value="custom">Custom (hand-adjusted)</option>}
            {availableTuningProfiles.map((p) => (
              <option key={p.name} value={p.name}>{p.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-600 mt-1.5">
            Only profiles fit against the GAUSSIAN smoothing kernel are listed -- this codebase only implements
            that kernel family, so a profile fit against a different shape (e.g. a "sigmoid" or "cauchy" tuning
            run) can't be applied correctly here and is intentionally left out.
          </p>
        </div>

        <div className="flex flex-col gap-4 border-t border-border pt-3">
          {strikeSchema && MATERIAL_KEYS.map((key) => (
            <ParamControl
              key={key}
              name={key}
              spec={strikeSchema[key]}
              value={materialParams[key]}
              onChange={(v) => setMaterialParam(key, Number(v))}
            />
          ))}
          {!strikeSchema && (
            <div className="text-xs text-gray-500">Loading param schema…</div>
          )}
        </div>

        <p className="text-[10px] text-gray-600 border-t border-border pt-3">
          Applies globally to every slab_strike node in the current graph, the same way "Physical press limit"
          does -- a chain always uses one consistent material model, not a per-node mix.
        </p>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-3 py-2 border-b border-border text-xs text-gray-400">
          <span className="font-semibold uppercase tracking-wide text-[10px]">Smoothing kernel shape</span>
          <span className="text-gray-600 ml-2">
            weight vs. axial distance from the strike center -- updates live as you adjust the sliders
          </span>
        </div>
        {(aheadHardEdge || behindHardEdge) && (
          <div className="px-3 py-1.5 text-[10px] text-amber-300/90 bg-amber-950/30 border-b border-border">
            {aheadHardEdge && behindHardEdge
              ? "Hard edge on both sides — no axial smoothing at all: the strike's effect is confined to exactly its own slab. This IS the original slab model's default behavior (matches apply_hit's own beta=0.3, decay=0, power=2.0 defaults), not a bug."
              : `Hard edge ${aheadHardEdge ? "ahead" : "behind"} the strike — no smoothing on that side; the strike's effect is confined to exactly its own slab there.`}
          </div>
        )}
        <div ref={plotContainerRef} className="flex-1 min-h-0">
          <Plot
            data={[
              {
                x, y, type: "scatter", mode: "lines",
                line: { color: "#7c6af7", width: 2 },
                fill: "tozeroy", fillcolor: "rgba(124,106,247,0.15)",
                hovertemplate: "distance %{x:.1f}mm<br>weight %{y:.3f}<extra></extra>",
                name: "kernel weight",
                showlegend: false,
              },
              // Always-visible marker at the strike itself (weight=1 by
              // construction, every profile) -- distinct from the line
              // trace so the "full weight exactly at the hit" point reads
              // clearly even in the hard-edge case, where the line trace
              // is otherwise a near-invisible single-sample spike.
              {
                x: [0], y: [1], type: "scatter", mode: "markers",
                marker: { color: "#facc15", size: 8, line: { color: "#1a1d27", width: 1 } },
                hovertemplate: "at the strike itself: weight 1<extra></extra>",
                showlegend: false,
              },
            ]}
            layout={{
              paper_bgcolor: "#1a1d27", plot_bgcolor: "#1a1d27",
              font: { color: "#e2e8f0", size: 11 },
              margin: { t: 12, r: 16, b: 40, l: 46 },
              xaxis: {
                title: { text: "distance from strike center (mm)" },
                range: [-KERNEL_PLOT_RANGE_MM, KERNEL_PLOT_RANGE_MM],
                gridcolor: "#2a2d3e", zerolinecolor: "#2a2d3e",
              },
              yaxis: { title: { text: "weight" }, range: [0, 1.05], gridcolor: "#2a2d3e", zerolinecolor: "#2a2d3e" },
              shapes: [
                {
                  type: "line", x0: 0, x1: 0, y0: 0, y1: 1, xref: "x", yref: "paper",
                  line: { color: "#4b5563", width: 1, dash: "dot" },
                },
                // Shade the hard-edged side(s) instead of leaving them a
                // blank/empty-looking region of the plot.
                ...(aheadHardEdge
                  ? [{
                      type: "rect" as const, x0: 0, x1: KERNEL_PLOT_RANGE_MM, y0: 0, y1: 1, xref: "x" as const, yref: "paper" as const,
                      fillcolor: "rgba(251,191,36,0.06)", line: { width: 0 },
                    }]
                  : []),
                ...(behindHardEdge
                  ? [{
                      type: "rect" as const, x0: -KERNEL_PLOT_RANGE_MM, x1: 0, y0: 0, y1: 1, xref: "x" as const, yref: "paper" as const,
                      fillcolor: "rgba(251,191,36,0.06)", line: { width: 0 },
                    }]
                  : []),
              ],
              annotations: [
                ...(aheadHardEdge
                  ? [{
                      x: KERNEL_PLOT_RANGE_MM / 2, y: 0.5, xref: "x" as const, yref: "paper" as const,
                      text: "no smoothing", showarrow: false, font: { size: 10, color: "#fbbf24" },
                    }]
                  : []),
                ...(behindHardEdge
                  ? [{
                      x: -KERNEL_PLOT_RANGE_MM / 2, y: 0.5, xref: "x" as const, yref: "paper" as const,
                      text: "no smoothing", showarrow: false, font: { size: 10, color: "#fbbf24" },
                    }]
                  : []),
              ],
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: "100%", height: "100%" }}
            useResizeHandler
          />
        </div>
      </div>
    </div>
  );
}
