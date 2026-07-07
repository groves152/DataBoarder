import Plot from "react-plotly.js";
import { useTagData } from "@/hooks/useTagData";
import type { HistogramData } from "@/types";

interface Props { run: string; tag: string }

export function HistogramPanel({ run, tag }: Props) {
  const entries = useTagData(run, tag);
  const latest = entries.at(-1);
  const data = latest?.data as HistogramData | undefined;

  if (!data) return <div className="p-4 text-gray-400 text-sm">No data yet</div>;

  const midpoints = data.edges.slice(0, -1).map((e, i) => (e + data.edges[i + 1]) / 2);

  return (
    <Plot
      data={[{ x: midpoints, y: data.counts, type: "bar", name: tag, marker: { color: "#7c6af7" } }]}
      layout={{
        paper_bgcolor: "#1a1d27", plot_bgcolor: "#1a1d27",
        font: { color: "#e2e8f0", size: 11 },
        margin: { t: 8, r: 16, b: 36, l: 52 },
        xaxis: { gridcolor: "#2a2d3e", zerolinecolor: "#2a2d3e" },
        yaxis: { gridcolor: "#2a2d3e", zerolinecolor: "#2a2d3e" },
      }}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}
