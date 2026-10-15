import { useState, useMemo } from "react";
import Plot from "react-plotly.js";
import { useTagData } from "@/hooks/useTagData";
import { ema } from "@/utils/smoothing";
import type { ScalarData, ScalarsData, TagEntry } from "@/types";
import { plotLayout, seriesColor, useResolvedTheme } from "@/theme";

interface Props { run: string; tag: string }

function toSeries(entries: TagEntry[]) {
  const series: Record<string, { steps: number[]; values: number[] }> = {};
  for (const entry of entries) {
    if (entry.type === "scalar") {
      const d = entry.data as ScalarData;
      if (!series["value"]) series["value"] = { steps: [], values: [] };
      series["value"].steps.push(d.step);
      series["value"].values.push(d.value);
    } else if (entry.type === "scalars") {
      const d = entry.data as ScalarsData;
      for (const [k, v] of Object.entries(d.values)) {
        if (!series[k]) series[k] = { steps: [], values: [] };
        series[k].steps.push(d.step);
        series[k].values.push(v);
      }
    }
  }
  return series;
}

export function ScalarPanel({ run, tag }: Props) {
  const entries = useTagData(run, tag);
  const [smoothing, setSmoothing] = useState(0.6);
  const series = useMemo(() => toSeries(entries), [entries]);
  const theme = useResolvedTheme();

  const traces = useMemo(() => {
    const result: Plotly.Data[] = [];
    let ci = 0;
    for (const [name, { steps, values }] of Object.entries(series)) {
      const color = seriesColor(ci++, theme);  // fixed slot order, never cycled
      const smoothed = ema(values, smoothing);
      const label = Object.keys(series).length === 1 ? tag : `${tag}/${name}`;
      if (smoothing > 0.05) {
        result.push({
          x: steps, y: values, type: "scatter", mode: "lines",
          name: `${label} (raw)`, line: { color, width: 1 },
          opacity: 0.25, showlegend: false, hoverinfo: "skip",
        } as Plotly.Data);
      }
      result.push({
        x: steps, y: smoothed, type: "scatter", mode: "lines",
        name: label, line: { color, width: 2 },
        hovertemplate: `step: %{x}<br>value: %{y:.4f}<extra>${label}</extra>`,
      } as Plotly.Data);
    }
    return result;
  }, [series, smoothing, tag, theme]);

  return (
    <div className="flex flex-col h-full">
      <Plot
        data={traces}
        layout={{
          ...plotLayout(theme),
          margin: { t: 8, r: 16, b: 36, l: 52 },
          xaxis: { ...(plotLayout(theme).xaxis as object), title: { text: "step" } },
          hovermode: "x unified",
          uirevision: `${run}/${tag}`,
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%", flex: 1, minHeight: 0 }}
        useResizeHandler
      />
      <div className="flex items-center gap-2 px-3 pb-2 pt-1 text-xs text-gray-400 shrink-0">
        <span className="shrink-0">Smooth</span>
        <input type="range" min={0} max={0.999} step={0.001} value={smoothing}
          onChange={(e) => setSmoothing(Number(e.target.value))}
          className="flex-1 accent-accent" />
        <span className="w-10 text-right tabular-nums">{smoothing.toFixed(2)}</span>
      </div>
    </div>
  );
}
