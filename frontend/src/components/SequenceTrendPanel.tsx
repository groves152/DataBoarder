import { useMemo } from "react";
import Plot from "react-plotly.js";
import { usePipelineStore } from "@/stores/pipelineStore";
import { topologicalOrder } from "@/utils/graphOrder";

interface Props {
  // Which step MeshPanel is CURRENTLY showing during sequence playback
  // (via its onFrameChange callback) -- drawn as a moving vertical
  // "timeline cursor" line across every row. null outside of active
  // playback/scrubbing.
  playbackStep: number | null;
  // Whichever node is selected in the graph (independent of playback) --
  // highlighted as a distinct marker on each row's own trace, so clicking
  // through a chain to inspect/edit a node also shows where it lands on
  // the trend. Not mutually exclusive with playbackStep; both can be
  // visible at once.
  selectedNodeId: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
}

interface Row { key: string; label: string; unit?: string }

// One row per quantity, not one overlaid chart -- z/rho/phi/reward have
// wildly different scales (mm, mm, radians, an unbounded log-ratio), so
// overlaying them on one y-axis would flatten the smaller-magnitude ones
// to invisible noise. Mirrors the 3-separate-subplots convention already
// used for this same data shape elsewhere (the per-hit action-component
// eval plots in slab_rl_eval.py's action_component_plot).
const ROWS: Row[] = [
  { key: "z", label: "z", unit: "mm" },
  { key: "rho", label: "rho", unit: "mm" },
  { key: "phi", label: "phi", unit: "rad" },
  { key: "chi_reward", label: "reward" },
];

const COLORS = ["#7c6af7", "#f97316", "#22d3ee", "#4ade80"];
const SELECTED_MARKER_COLOR = "#ffffff";

export function SequenceTrendPanel({ playbackStep, selectedNodeId, expanded, onToggleExpanded, onClose }: Props) {
  const nodes = usePipelineStore((s) => s.nodes);
  const edges = usePipelineStore((s) => s.edges);
  const diagnostics = usePipelineStore((s) => s.diagnostics);

  // Same topological order the server computes for "{tag}/__sequence__"
  // (graph.py's Kahn's algorithm, mirrored client-side in graphOrder.ts,
  // both FIFO-tie-broken in the same node-array order the graph was sent
  // in) -- so a step index here lines up 1:1 with the mesh panel's own
  // step numbering, no separate lookup needed.
  const order = useMemo(() => topologicalOrder(nodes, edges) ?? [], [nodes, edges]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedStep = selectedNodeId ? order.indexOf(selectedNodeId) : -1; // -1 -> never matches a real step

  const series = useMemo(() => {
    const result: Record<string, { x: number[]; y: number[] }> = {};
    for (const r of ROWS) result[r.key] = { x: [], y: [] };
    order.forEach((nodeId, step) => {
      const node = byId.get(nodeId);
      const diag = diagnostics[nodeId];
      for (const r of ROWS) {
        // Values simply aren't pushed for a step that lacks this field
        // (e.g. slab_stock's root has no z/rho/phi; a strike has no
        // chi_reward until a goal is selected) -- Plotly draws the line
        // straight through the gap, which is the right visual for
        // "this quantity doesn't apply here" rather than a fake 0.
        const v = r.key === "chi_reward" ? diag?.chi_reward : node?.data.params[r.key];
        if (typeof v === "number") {
          result[r.key].x.push(step);
          result[r.key].y.push(v);
        }
      }
    });
    return result;
  }, [order, byId, diagnostics]);

  const activeRows = ROWS.filter((r) => series[r.key].x.length > 0);
  const n = activeRows.length;

  const header = (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border text-xs text-gray-400 shrink-0">
      <span className="font-semibold uppercase tracking-wide text-[10px]">Actions &amp; reward</span>
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onToggleExpanded}
          title={expanded ? "Narrow panel" : "Widen panel"}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-surface hover:text-white transition-colors"
        >
          {expanded ? "⇥" : "⇤"}
        </button>
        <button
          onClick={onClose}
          title="Hide this panel"
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-surface hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );

  if (n === 0) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="flex-1 flex items-center justify-center text-xs text-gray-500 p-4 text-center">
          No per-step action/reward data yet — cook a strike sequence to see it here.
        </div>
      </div>
    );
  }

  const domainGap = 0.08;
  const rowHeight = (1 - domainGap * (n - 1)) / n;

  const data: Plotly.Data[] = [];
  const layout: Partial<Plotly.Layout> = {
    paper_bgcolor: "#1a1d27", plot_bgcolor: "#1a1d27",
    font: { color: "#e2e8f0", size: 10 },
    margin: { t: 8, r: 12, b: 30, l: 46 },
    showlegend: false,
    hovermode: "x unified",
    shapes: [],
  };

  activeRows.forEach((r, i) => {
    const n1 = i + 1;
    const xKey = n1 === 1 ? "x" : `x${n1}`;
    const yKey = n1 === 1 ? "y" : `y${n1}`;
    const top = 1 - i * (rowHeight + domainGap);
    const bottom = top - rowHeight;
    const color = COLORS[i % COLORS.length];

    (layout as Record<string, unknown>)[n1 === 1 ? "xaxis" : `xaxis${n1}`] = {
      domain: [0, 1], anchor: yKey,
      gridcolor: "#2a2d3e", zerolinecolor: "#2a2d3e",
      matches: i === 0 ? undefined : "x", // zoom/pan stays synced across rows
      showticklabels: i === n - 1,
      title: i === n - 1 ? { text: "step" } : undefined,
    };
    (layout as Record<string, unknown>)[n1 === 1 ? "yaxis" : `yaxis${n1}`] = {
      domain: [bottom, top], anchor: xKey,
      gridcolor: "#2a2d3e", zerolinecolor: "#2a2d3e",
      title: { text: r.unit ? `${r.label} (${r.unit})` : r.label, font: { size: 9 } },
    };

    // Per-point highlight for the SELECTED node -- a bigger, white-ringed
    // marker at that one x value, distinct from the moving playback line
    // below (selection is a static "here's this one thing", playback is a
    // sweeping "here's where we are in time").
    data.push({
      x: series[r.key].x, y: series[r.key].y, xaxis: xKey, yaxis: yKey,
      type: "scatter", mode: "lines+markers",
      line: { color, width: 1.5 },
      marker: {
        size: series[r.key].x.map((xv) => (xv === selectedStep ? 9 : 4)),
        color: series[r.key].x.map((xv) => (xv === selectedStep ? SELECTED_MARKER_COLOR : color)),
        line: { color, width: series[r.key].x.map((xv) => (xv === selectedStep ? 2 : 0)) },
      },
      hovertemplate: `step %{x}<br>${r.label}: %{y:.3f}<extra></extra>`,
    } as Plotly.Data);

    if (playbackStep != null) {
      (layout.shapes as Partial<Plotly.Shape>[]).push({
        type: "line",
        xref: xKey as Plotly.XAxisName, yref: `${yKey} domain` as Plotly.YAxisName,
        x0: playbackStep, x1: playbackStep, y0: 0, y1: 1,
        line: { color: "#facc15", width: 1.5 },
      });
    }
  });

  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 min-h-0">
        <Plot
          // react-plotly.js's `useResizeHandler` only listens for WINDOW
          // resize events -- toggling `expanded` changes this panel's
          // container width via a class swap, not a window resize, so
          // Plotly never re-measured and the plot stayed rendered at its
          // old size. Keying on `expanded` forces a full remount instead:
          // the parent div's new width class is already applied by the
          // time the fresh Plot instance mounts and measures its
          // container, in the same React commit.
          key={expanded ? "expanded" : "normal"}
          data={data}
          layout={layout}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      </div>
    </div>
  );
}
