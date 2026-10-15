/**
 * Renders a panel with multiple data sources.
 *
 * overlay    — all scalar series overlaid on one Plotly chart
 * sidebyside — two Plotly subplots sharing the x-axis (scalars only)
 * split      — each source in its own horizontal stripe
 */
import { useState, useMemo } from "react";
import Plot from "react-plotly.js";
import { useTagData } from "@/hooks/useTagData";
import { ema } from "@/utils/smoothing";
import { useLayoutStore } from "@/stores/layoutStore";
import type { DataSource, MergeMode, ScalarData, ScalarsData } from "@/types";
import { ScalarPanel } from "./ScalarPanel";
import { HistogramPanel } from "./HistogramPanel";
import { ImagePanel } from "./ImagePanel";
import { MeshPanel } from "./MeshPanel";
import { plotAxis, plotLayout, seriesColor, useResolvedTheme } from "@/theme";

interface Props {
  panelId: string;
  sources: DataSource[];
  mergeMode: MergeMode;
}

// ── Overlay: all scalar traces in one chart ───────────────────────────────────
function OverlayPanel({ sources, smoothing, uirev }: { sources: DataSource[]; smoothing: number; uirev: string }) {
  type Series = { label: string; steps: number[]; values: number[] };

  function useAllSeries(): Series[] {
    const results: Series[] = [];
    // Rules: each DataSource contributes N series (one per key for scalars type)
    // We call hooks unconditionally by rendering a hook per source index
    for (let i = 0; i < sources.length; i++) {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const entries = useTagData(sources[i].run, sources[i].tag);
      const prefix = sources.length > 1 ? `${sources[i].run}/${sources[i].tag}` : sources[i].tag;
      for (const entry of entries) {
        if (entry.type === "scalar") {
          const d = entry.data as ScalarData;
          const existing = results.find((s) => s.label === prefix);
          if (existing) { existing.steps.push(d.step); existing.values.push(d.value); }
          else results.push({ label: prefix, steps: [d.step], values: [d.value] });
        } else if (entry.type === "scalars") {
          const d = entry.data as ScalarsData;
          for (const [k, v] of Object.entries(d.values)) {
            const label = `${prefix}/${k}`;
            const existing = results.find((s) => s.label === label);
            if (existing) { existing.steps.push(d.step); existing.values.push(v); }
            else results.push({ label, steps: [d.step], values: [v] });
          }
        }
      }
    }
    return results;
  }

  const allSeries = useAllSeries();
  const theme = useResolvedTheme();

  const traces = useMemo(() => {
    const out: Plotly.Data[] = [];
    allSeries.forEach(({ label, steps, values }, i) => {
      const color = seriesColor(i, theme);  // fixed slot order, never cycled
      const smoothed = ema(values, smoothing);
      if (smoothing > 0.05) {
        out.push({ x: steps, y: values, type: "scatter", mode: "lines",
          line: { color, width: 1 }, opacity: 0.2, showlegend: false, hoverinfo: "skip" } as Plotly.Data);
      }
      out.push({ x: steps, y: smoothed, type: "scatter", mode: "lines",
        name: label, line: { color, width: 2 },
        hovertemplate: `step: %{x}<br>%{y:.4f}<extra>${label}</extra>` } as Plotly.Data);
    });
    return out;
  }, [allSeries, smoothing, theme]);

  return (
    <Plot
      data={traces}
      layout={{
        ...plotLayout(theme),
        margin: { t: 8, r: 16, b: 36, l: 52 },
        xaxis: plotAxis(theme, { title: { text: "step" } }),
        hovermode: "x unified",
        uirevision: uirev,
      }}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

// ── Side-by-side: Plotly subplot grid sharing the x-axis ─────────────────────
function SideBySidePanel({ sources, smoothing, uirev }: { sources: DataSource[]; smoothing: number; uirev: string }) {
  function useSource(src: DataSource): { steps: number[]; values: number[] }[] {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const entries = useTagData(src.run, src.tag);
    const seriesMap: Record<string, { steps: number[]; values: number[] }> = {};
    for (const entry of entries) {
      if (entry.type === "scalar") {
        const d = entry.data as ScalarData;
        if (!seriesMap["v"]) seriesMap["v"] = { steps: [], values: [] };
        seriesMap["v"].steps.push(d.step); seriesMap["v"].values.push(d.value);
      } else if (entry.type === "scalars") {
        const d = entry.data as ScalarsData;
        for (const [k, v] of Object.entries(d.values)) {
          if (!seriesMap[k]) seriesMap[k] = { steps: [], values: [] };
          seriesMap[k].steps.push(d.step); seriesMap[k].values.push(v);
        }
      }
    }
    return Object.values(seriesMap);
  }

  // Call hooks unconditionally for each source slot
  const s0 = useSource(sources[0]);
  const s1 = useSource(sources[1] ?? sources[0]);
  const theme = useResolvedTheme();

  const traces = useMemo(() => {
    const out: Plotly.Data[] = [];
    [s0, s1].forEach((seriesList, col) => {
      seriesList.forEach(({ steps, values }, si) => {
        const color = seriesColor(col * 3 + si, theme);
        const smoothed = ema(values, smoothing);
        out.push({
          x: steps, y: smoothed, type: "scatter", mode: "lines",
          name: `${sources[col]?.tag ?? ""}${seriesList.length > 1 ? `/${si}` : ""}`,
          xaxis: col === 0 ? "x" : "x2",
          yaxis: col === 0 ? "y" : "y2",
          line: { color, width: 2 },
        } as Plotly.Data);
      });
    });
    return out;
  }, [s0, s1, smoothing, sources, theme]);

  return (
    <Plot
      data={traces}
      layout={{
        ...plotLayout(theme),
        margin: { t: 8, r: 16, b: 40, l: 48 },
        grid: { rows: 1, columns: 2, pattern: "independent" },
        xaxis:  plotAxis(theme, { title: { text: sources[0]?.tag ?? "" } }),
        xaxis2: plotAxis(theme, { title: { text: sources[1]?.tag ?? "" } }),
        yaxis2: plotAxis(theme),
        uirevision: uirev,
      }}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

// ── Split: each source in its own stripe ─────────────────────────────────────
function SourceStripe({ source }: { source: DataSource }) {
  switch (source.type) {
    case "scalar":
    case "scalars":   return <ScalarPanel    run={source.run} tag={source.tag} />;
    case "histogram": return <HistogramPanel  run={source.run} tag={source.tag} />;
    case "image":
    case "images":    return <ImagePanel      run={source.run} tag={source.tag} />;
    case "mesh":      return <MeshPanel       run={source.run} tag={source.tag} />;
    default:          return null;
  }
}

// ── Root multi-panel ──────────────────────────────────────────────────────────
export function MultiPanel({ panelId, sources, mergeMode }: Props) {
  const [smoothing, setSmoothing] = useState(0.6);
  const setMergeMode = useLayoutStore((s) => s.setMergeMode);

  const allScalar = sources.every((s) => s.type === "scalar" || s.type === "scalars");
  const uirev = sources.map((s) => `${s.run}/${s.tag}`).join("|");

  const modeButtons: { label: string; value: MergeMode; show: boolean }[] = [
    { label: "Overlay",     value: "overlay",    show: allScalar },
    { label: "Side by side",value: "sidebyside", show: allScalar && sources.length === 2 },
    { label: "Split",       value: "split",      show: true },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Mode switcher */}
      <div className="flex items-center gap-1 px-2 pt-1 shrink-0">
        {modeButtons.filter((b) => b.show).map((b) => (
          <button key={b.value}
            onClick={() => setMergeMode(panelId, b.value)}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors
              ${mergeMode === b.value
                ? "bg-accent text-white"
                : "text-gray-500 hover:text-gray-300 bg-border"}`}>
            {b.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-gray-600">{sources.length} sources</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {mergeMode === "overlay" && allScalar && (
          <OverlayPanel sources={sources} smoothing={smoothing} uirev={uirev} />
        )}
        {mergeMode === "sidebyside" && allScalar && (
          <SideBySidePanel sources={sources.slice(0, 2)} smoothing={smoothing} uirev={uirev} />
        )}
        {mergeMode === "split" && (
          <div className="flex flex-col h-full divide-y divide-border">
            {sources.map((src) => (
              <div key={`${src.run}::${src.tag}`} className="flex-1 min-h-0">
                <SourceStripe source={src} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Smoothing slider — only for scalar modes */}
      {(mergeMode === "overlay" || mergeMode === "sidebyside") && allScalar && (
        <div className="flex items-center gap-2 px-3 pb-2 pt-1 text-xs text-gray-400 shrink-0">
          <span className="shrink-0">Smooth</span>
          <input type="range" min={0} max={0.999} step={0.001} value={smoothing}
            onChange={(e) => setSmoothing(Number(e.target.value))}
            className="flex-1 accent-accent" />
          <span className="w-10 text-right tabular-nums">{smoothing.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
