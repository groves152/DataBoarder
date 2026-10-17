import { useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import { usePipelineStore } from "@/stores/pipelineStore";
import { useCurrentProgram } from "@/hooks/useCurrentProgram";
import { useDispatchResizeOnContainerResize } from "@/utils/useDispatchResizeOnContainerResize";
import { CHROME, plotAxis, plotLayout, seriesColor, useResolvedTheme } from "@/theme";

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
  // Shows this panel's own header with a close button (omit when a container,
  // e.g. the side panel's tab bar, provides one).
  onClose?: () => void;
}

type Ctx = { params: Record<string, unknown>; diag: Record<string, unknown> | undefined; prevLength: number | undefined };
interface Metric {
  key: string;
  label: string;
  unit?: string;
  group: string;
  get: (c: Ctx) => unknown;
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const kN = (v: unknown) => (num(v) === undefined ? undefined : (v as number) / 1e3);

// Everything the stats can plot: the actions (node params) and what the cook
// reported per node (forge-genie ops_diagnostics). One row each, not one
// overlaid chart: the scales (mm, rad, kN, °C) differ too much to share an
// axis. A metric shows up in the picker once any node in the graph has it.
const METRICS: Metric[] = [
  { key: "s0", label: "position s0", unit: "mm", group: "Action", get: (c) => c.params.s0 ?? c.params.s0_start },
  { key: "z", label: "z", unit: "mm", group: "Action", get: (c) => c.params.z },
  { key: "rho", label: "die gap rho", unit: "mm", group: "Action", get: (c) => c.params.rho },
  { key: "phi", label: "angle phi", unit: "rad", group: "Action", get: (c) => c.params.phi },
  { key: "force", label: "press force", unit: "kN", group: "Press",
    get: (c) => kN(c.diag?.force_N ?? c.diag?.force_N_max) },
  { key: "required_load", label: "required load", unit: "kN", group: "Press",
    get: (c) => kN(c.diag?.required_load_N ?? c.diag?.required_load_N_max) },
  { key: "n_capped", label: "hits capped by the press", group: "Press", get: (c) => c.diag?.n_capped },
  { key: "T_min", label: "part T min", unit: "°C", group: "Thermal", get: (c) => c.diag?.T_part_min_C ?? c.diag?.T_min_C },
  { key: "T_max", label: "part T max", unit: "°C", group: "Thermal", get: (c) => c.diag?.T_part_max_C ?? c.diag?.T_max_C },
  { key: "energy", label: "heat energy", unit: "kJ", group: "Thermal", get: (c) => kN(c.diag?.energy_J) },
  { key: "length", label: "length", unit: "mm", group: "Shape", get: (c) => c.diag?.length_mm },
  { key: "elongation", label: "Δ length", unit: "mm", group: "Shape",
    get: (c) => (num(c.diag?.length_mm) !== undefined && c.prevLength !== undefined
      ? (c.diag!.length_mm as number) - c.prevLength : undefined) },
  { key: "d_eq_min", label: "size min (d_eq)", unit: "mm", group: "Shape", get: (c) => c.diag?.d_eq_min_mm },
  { key: "d_eq_mean", label: "size mean (d_eq)", unit: "mm", group: "Shape", get: (c) => c.diag?.d_eq_mean_mm },
  { key: "d_eq_max", label: "size max (d_eq)", unit: "mm", group: "Shape", get: (c) => c.diag?.d_eq_max_mm },
  { key: "volume", label: "volume vs stock", unit: "%", group: "Shape",
    get: (c) => (num(c.diag?.volume_vs_stock_rel) === undefined ? undefined : 100 * (c.diag!.volume_vs_stock_rel as number)) },
  { key: "roughness", label: "roughness", group: "Shape", get: (c) => c.diag?.roughness },
  { key: "curvature", label: "max profile curvature", unit: "1/mm", group: "Shape",
    get: (c) => c.diag?.profile_curvature_max_1pmm },
  { key: "bend", label: "max bend curvature", unit: "1/mm", group: "Shape", get: (c) => c.diag?.bend_curvature_max_1pmm },
  { key: "strain", label: "max strain", group: "Shape", get: (c) => c.diag?.strain_max },
  { key: "springback", label: "springback", unit: "rad", group: "Shape", get: (c) => c.diag?.springback_rad },
  { key: "chi_reward", label: "reward", group: "Goal", get: (c) => c.diag?.chi_reward },
];
const DEFAULT_METRICS = ["rho", "phi", "required_load", "length", "chi_reward"];
const GROUPS = [...new Set(METRICS.map((m) => m.group))];

// The picks are remembered in this browser (when storage is available).
function useStoredList(key: string, initial: string[]): [string[], (v: string[]) => void] {
  const [value, setValue] = useState<string[]>(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(key) ?? "null");
      return Array.isArray(v) ? v : initial;
    } catch {
      return initial;
    }
  });
  return [value, (v) => {
    setValue(v);
    try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* not remembered */ }
  }];
}

const kindLabel = (kind: string) => kind.replace(/^ops_/, "").replace(/_/g, " ");


export function SequenceTrendPanel({ playbackStep, selectedNodeId, onClose }: Props) {
  const nodes = usePipelineStore((s) => s.nodes);
  const diagnostics = usePipelineStore((s) => s.diagnostics);
  const theme = useResolvedTheme();
  const [picked, setPicked] = useStoredList("pipeline.stats.metrics", DEFAULT_METRICS);
  const [hiddenKinds, setHiddenKinds] = useStoredList("pipeline.stats.hiddenKinds", []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [pickerOpen]);

  // Same topological order the server computes for the program's sequence
  // tag (graph.py's Kahn's algorithm, mirrored client-side in graphOrder.ts
  // and utils/programs.ts, both FIFO-tie-broken in the same node-array order
  // the graph was sent in) -- so a step index here lines up 1:1 with the
  // mesh panel's own step numbering, no separate lookup needed.
  const plotContainerRef = useRef<HTMLDivElement>(null);
  useDispatchResizeOnContainerResize(plotContainerRef);

  // Several programs in the graph: the one the viewport's replay follows.
  const { current } = useCurrentProgram();
  const order = useMemo(() => current?.nodeIds ?? [], [current]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedStep = selectedNodeId ? order.indexOf(selectedNodeId) : -1; // -1 -> never matches a real step
  const kinds = useMemo(() => [...new Set(order.map((id) => byId.get(id)?.data.kind ?? ""))].filter(Boolean),
    [order, byId]);

  // Every metric's points, over the ops that pass the op filter. x stays the
  // step index in the whole sequence, so the playback line still lines up.
  const series = useMemo(() => {
    const result: Record<string, { x: number[]; y: number[]; text: string[] }> = {};
    for (const m of METRICS) result[m.key] = { x: [], y: [], text: [] };
    let prevLength: number | undefined;
    order.forEach((nodeId, step) => {
      const node = byId.get(nodeId);
      const diag = diagnostics[nodeId];
      const ctx: Ctx = { params: node?.data.params ?? {}, diag, prevLength };
      if (typeof diag?.length_mm === "number") prevLength = diag.length_mm;
      if (!node || hiddenKinds.includes(node.data.kind)) return;
      const text = typeof node.data.params.label === "string" && node.data.params.label
        ? node.data.params.label : node.id;
      for (const m of METRICS) {
        // A step that lacks a quantity simply has no point (the stock has no
        // rho, a heat no force): the line runs through the gap.
        const v = num(m.get(ctx));
        if (v === undefined) continue;
        result[m.key].x.push(step);
        result[m.key].y.push(v);
        result[m.key].text.push(text);
      }
    });
    return result;
  }, [order, byId, diagnostics, hiddenKinds]);

  const available = METRICS.filter((m) => series[m.key].x.length > 0);
  const toolbar = (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-border text-[10px] shrink-0">
      <div className="relative" ref={pickerRef}>
        <button onClick={() => setPickerOpen((o) => !o)}
                className="px-1.5 py-0.5 rounded border border-border text-gray-300 hover:border-accent">
          Metrics ({picked.filter((k) => available.some((m) => m.key === k)).length}) ▾
        </button>
        {pickerOpen && (
          <div className="absolute z-40 mt-1 w-60 max-h-80 overflow-y-auto rounded-md border border-border bg-panel shadow-xl py-1">
            {GROUPS.map((g) => {
              const ms = available.filter((m) => m.group === g);
              if (ms.length === 0) return null;
              return (
                <div key={g}>
                  <div className="px-3 pt-1.5 pb-0.5 uppercase tracking-wide text-gray-500">{g}</div>
                  {ms.map((m) => (
                    <label key={m.key} className="flex items-center gap-2 px-3 py-0.5 text-gray-300 hover:bg-surface cursor-pointer select-none">
                      <input type="checkbox" className="accent-accent" checked={picked.includes(m.key)}
                             onChange={(e) => setPicked(e.target.checked ? [...picked, m.key] : picked.filter((k) => k !== m.key))} />
                      <span>{m.label}{m.unit ? ` (${m.unit})` : ""}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <span className="text-gray-500 ml-1">ops</span>
      {kinds.map((k) => {
        const on = !hiddenKinds.includes(k);
        return (
          <button key={k} onClick={() => setHiddenKinds(on ? [...hiddenKinds, k] : hiddenKinds.filter((h) => h !== k))}
                  title={on ? `Hide ${kindLabel(k)} steps` : `Show ${kindLabel(k)} steps`}
                  className={`px-1.5 py-0.5 rounded border transition-colors ${
                    on ? "border-accent text-gray-200" : "border-border text-gray-500 line-through"}`}>
            {kindLabel(k)}
          </button>
        );
      })}
    </div>
  );

  const activeRows = METRICS.filter((m) => picked.includes(m.key) && series[m.key].x.length > 0);
  const n = activeRows.length;

  const header = onClose && (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border text-xs text-gray-400 shrink-0">
      <span className="font-semibold uppercase tracking-wide text-[10px]">Actions &amp; reward</span>
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onClose}
          title="Hide this panel"
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-surface hover:text-gray-100 transition-colors"
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
        {available.length > 0 && toolbar}
        <div className="flex-1 flex items-center justify-center text-xs text-gray-500 p-4 text-center">
          {available.length > 0 ? "Nothing picked: choose metrics (or ops) above."
            : "No per-step data yet — cook a sequence to see it here."}
        </div>
      </div>
    );
  }

  const domainGap = 0.08;
  const rowHeight = (1 - domainGap * (n - 1)) / n;

  const data: Plotly.Data[] = [];
  const layout: Partial<Plotly.Layout> = {
    ...(plotLayout(theme, 10) as Partial<Plotly.Layout>),
    margin: { t: 14, r: 12, b: 30, l: 40 },
    showlegend: false,
    hovermode: "x unified",
    shapes: [],
    annotations: [],
  };

  activeRows.forEach((r, i) => {
    const n1 = i + 1;
    const xKey = n1 === 1 ? "x" : `x${n1}`;
    const yKey = n1 === 1 ? "y" : `y${n1}`;
    const top = 1 - i * (rowHeight + domainGap);
    const bottom = top - rowHeight;
    const color = seriesColor(i, theme);  // one metric per row: the row title names it

    (layout as Record<string, unknown>)[n1 === 1 ? "xaxis" : `xaxis${n1}`] = {
      ...plotAxis(theme),
      domain: [0, 1], anchor: yKey,
      matches: i === 0 ? undefined : "x", // zoom/pan stays synced across rows
      showticklabels: i === n - 1,
      title: i === n - 1 ? { text: "step" } : undefined,
    };
    (layout as Record<string, unknown>)[n1 === 1 ? "yaxis" : `yaxis${n1}`] = {
      ...plotAxis(theme),
      domain: [bottom, top], anchor: xKey,
      nticks: 4,
    };
    // the row's name above it (horizontal: a rotated axis title collides with its neighbors')
    (layout.annotations as Partial<Plotly.Annotations>[]).push({
      xref: "paper", yref: `${yKey} domain` as Plotly.YAxisName, x: 0, y: 1, xanchor: "left", yanchor: "bottom",
      text: r.unit ? `${r.label} (${r.unit})` : r.label, showarrow: false, font: { size: 9, color: CHROME[theme].inkSecondary },
    });

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
        color: series[r.key].x.map((xv) => (xv === selectedStep ? CHROME[theme].surface : color)),
        line: { color, width: series[r.key].x.map((xv) => (xv === selectedStep ? 2 : 0)) },
      },
      text: series[r.key].text,
      hovertemplate: `step %{x} · %{text}<br>${r.label}: %{y:.3f}<extra></extra>`,
    } as Plotly.Data);

    if (playbackStep != null) {
      (layout.shapes as Partial<Plotly.Shape>[]).push({
        type: "line",
        xref: xKey as Plotly.XAxisName, yref: `${yKey} domain` as Plotly.YAxisName,
        x0: playbackStep, x1: playbackStep, y0: 0, y1: 1,
        line: { color: CHROME[theme].ink, width: 1.5, dash: "dot" },
      });
    }
  });

  return (
    <div className="flex flex-col h-full">
      {header}
      {toolbar}
      {/* rows keep a readable height: past five, the plot scrolls */}
      <div ref={plotContainerRef} className="flex-1 min-h-0 overflow-y-auto">
        <Plot
          data={data}
          layout={layout}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: "100%", height: n <= 5 ? "100%" : `${n * 95}px` }}
          useResizeHandler
        />
      </div>
    </div>
  );
}
