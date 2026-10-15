import { useEffect, useMemo, useRef } from "react";
import Plot from "react-plotly.js";
import { usePipelineStore } from "@/stores/pipelineStore";
import { ParamControl } from "./ParamControl";
import { sampleKernelProfile, KERNEL_PLOT_RANGE_MM } from "@/utils/gaussianKernel";
import { useDispatchResizeOnContainerResize } from "@/utils/useDispatchResizeOnContainerResize";
import { CHROME, plotAxis, plotLayout, seriesColor, useResolvedTheme } from "@/theme";

const MATERIAL_KEYS = [
  "beta", "plastic_decay_ahead_mm", "plastic_decay_behind_mm", "plastic_kernel_power",
] as const;

// Embedded in NodeInspector when the SELECTED node is a slab_stock root --
// tuning is per-chain now (gaussian tuning has no meaning for a forge_net
// chain, and two independent slab chains shouldn't be forced to share one
// material model), so this is scoped to `rootId`, not a global app-wide
// tab. Selecting a profile / dragging a slider here rewrites every
// slab_strike DESCENDANT of `rootId` (see pipelineStore's
// setTuningProfile/setMaterialParam) -- a chain always uses ONE
// consistent material model, matching the "physical press limit" toggle's
// existing precedent (just scoped to one chain instead of the whole
// graph now).
export function TuningPanel({ rootId }: { rootId: string }) {
  const theme = useResolvedTheme();
  const lineColor = seriesColor(0, theme);
  const {
    nodeKinds, fetchTuningProfiles, availableTuningProfiles, materialParamsForRoot, tuningProfileNameForRoot,
    setTuningProfile, setMaterialParam,
  } = usePipelineStore();

  useEffect(() => {
    fetchTuningProfiles();
  }, [fetchTuningProfiles]);

  const plotContainerRef = useRef<HTMLDivElement>(null);
  useDispatchResizeOnContainerResize(plotContainerRef);

  // Reuse the REAL backend-registered ParamSpecs (bounds/labels/
  // descriptions) for the 4 sliders, rather than duplicating magic
  // numbers here -- same schema slab_strike nodes already use.
  const strikeSchema = nodeKinds.find((k) => k.params.beta)?.params;

  const materialParams = materialParamsForRoot(rootId);
  const tuningProfileName = tuningProfileNameForRoot(rootId);

  const { x, y, aheadHardEdge, behindHardEdge } = useMemo(
    () => sampleKernelProfile(
      materialParams.plastic_decay_ahead_mm, materialParams.plastic_decay_behind_mm,
      materialParams.plastic_kernel_power,
    ),
    [materialParams.plastic_decay_ahead_mm, materialParams.plastic_decay_behind_mm, materialParams.plastic_kernel_power],
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Tuning profile (this chain)</div>
        <select
          value={tuningProfileName === "custom" ? "custom" : tuningProfileName}
          onChange={(e) => { if (e.target.value !== "custom") setTuningProfile(rootId, e.target.value); }}
          className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-gray-200"
        >
          {tuningProfileName === "custom" && <option value="custom">Custom (hand-adjusted)</option>}
          {availableTuningProfiles.map((p) => (
            <option key={p.name} value={p.name}>{p.label}</option>
          ))}
        </select>
        <p className="text-[10px] text-gray-600 mt-1.5">
          Only profiles fit against the GAUSSIAN smoothing kernel are listed. Applies to every strike chained from
          this stock node only -- a different slab chain elsewhere in the graph is unaffected.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {strikeSchema && MATERIAL_KEYS.map((key) => (
          <ParamControl
            key={key}
            name={key}
            spec={strikeSchema[key]}
            value={materialParams[key]}
            onChange={(v) => setMaterialParam(rootId, key, Number(v))}
          />
        ))}
        {!strikeSchema && (
          <div className="text-xs text-gray-500">Loading param schema…</div>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Smoothing kernel shape</div>
        {(aheadHardEdge || behindHardEdge) && (
          <div className="px-2 py-1.5 mb-1.5 text-[10px] text-amber-300/90 bg-amber-950/30 rounded">
            {aheadHardEdge && behindHardEdge
              ? "Hard edge on both sides — no axial smoothing. This IS the original slab model default, not a bug."
              : `Hard edge ${aheadHardEdge ? "ahead" : "behind"} the strike — no smoothing on that side.`}
          </div>
        )}
        <div ref={plotContainerRef} className="h-48">
          <Plot
            data={[
              {
                x, y, type: "scatter", mode: "lines",
                line: { color: lineColor, width: 2 },
                fill: "tozeroy", fillcolor: `${lineColor}26`,
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
                marker: { color: lineColor, size: 8, line: { color: CHROME[theme].surface, width: 2 } },
                hovertemplate: "at the strike itself: weight 1<extra></extra>",
                showlegend: false,
              },
            ]}
            layout={{
              ...plotLayout(theme, 10),
              margin: { t: 6, r: 10, b: 30, l: 36 },
              xaxis: plotAxis(theme, {
                title: { text: "distance (mm)", font: { size: 9 } },
                range: [-KERNEL_PLOT_RANGE_MM, KERNEL_PLOT_RANGE_MM],
              }),
              yaxis: plotAxis(theme, { title: { text: "weight", font: { size: 9 } }, range: [0, 1.05] }),
              shapes: [
                {
                  type: "line", x0: 0, x1: 0, y0: 0, y1: 1, xref: "x", yref: "paper",
                  line: { color: CHROME[theme].muted, width: 1, dash: "dot" },
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
