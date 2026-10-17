import { useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import { usePipelineStore } from "@/stores/pipelineStore";
import { useCurrentProgram } from "@/hooks/useCurrentProgram";
import { useDispatchResizeOnContainerResize } from "@/utils/useDispatchResizeOnContainerResize";
import { CHROME, plotAxis, plotLayout, seriesColor, useResolvedTheme } from "@/theme";
import { GOAL_COLOR } from "./GoalOverlay";

// The side panel's Profile tab: the part in view (the selected node, else its
// program's last step) against the goal and the pinned programs' final parts,
// along the bar (size, thickness or width) and as a cross-section at a chosen
// position -- the measurements behind "how close is it". Sections come from
// forge-genie's /api/forge/profile and /api/forge/goal_profile (profiles.py).
interface Profile {
  s: number[];
  r: number[][];
  d_eq: number[];
  thick: number[];
  wide: number[];
  n_theta: number;
}
type Measure = "d_eq" | "thick" | "wide";
const MEASURES: Record<Measure, string> = { d_eq: "size (area-equivalent diameter)", thick: "thickness", wide: "width" };

const nearest = (s: number[], x: number) => {
  let best = 0;
  for (let i = 1; i < s.length; i++) if (Math.abs(s[i] - x) < Math.abs(s[best] - x)) best = i;
  return best;
};
/** A profile's value at `x` (linear between sections), null outside it. */
function at(p: Profile, key: Measure, x: number): number | null {
  const { s } = p;
  if (s.length === 0 || x < s[0] || x > s[s.length - 1]) return null;
  let i = 1;
  while (i < s.length - 1 && s[i] < x) i++;
  const t = (x - s[i - 1]) / Math.max(s[i] - s[i - 1], 1e-9);
  return p[key][i - 1] + Math.min(1, Math.max(0, t)) * (p[key][i] - p[key][i - 1]);
}

async function getJson(url: string): Promise<Profile | null> {
  try {
    const res = await fetch(url);
    const data = await res.json();
    return res.ok && data.ok ? (data as Profile) : null;
  } catch {
    return null;
  }
}

export function ProfilePanel() {
  const { nodes, diagnostics, selectedNodeId, goalName, pinnedPrograms, run, tag } = usePipelineStore();
  const theme = useResolvedTheme();
  const { programs, current } = useCurrentProgram();
  const [measure, setMeasure] = useState<Measure>("d_eq");
  const [cut, setCut] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  useDispatchResizeOnContainerResize(plotRef);

  const partNode = selectedNodeId && nodes.some((n) => n.id === selectedNodeId)
    ? selectedNodeId : current?.nodeIds[current.nodeIds.length - 1] ?? null;
  const pinnedLast = programs.filter((p) => pinnedPrograms.includes(p.root) && p.root !== current?.root)
    .map((p) => ({ id: p.nodeIds[p.nodeIds.length - 1], color: seriesColor(programs.indexOf(p), theme) }));
  const wanted = [partNode, ...pinnedLast.map((p) => p.id)].filter((id): id is string => !!id);

  // Each part's profile, refetched after every cook (a cook replaces `diagnostics`).
  const [parts, setParts] = useState<Record<string, Profile | null>>({});
  const wantedKey = wanted.join("|");
  useEffect(() => {
    let alive = true;
    const ids = wantedKey ? wantedKey.split("|") : [];
    void Promise.all(ids.map(async (id) => [id, await getJson(
      `/api/forge/profile?run=${encodeURIComponent(run)}&tag=${encodeURIComponent(tag)}&node=${encodeURIComponent(id)}`)] as const))
      .then((got) => { if (alive) setParts(Object.fromEntries(got)); });
    return () => { alive = false; };
  }, [wantedKey, diagnostics, run, tag]);

  const [goal, setGoal] = useState<Profile | null>(null);
  useEffect(() => {
    if (!goalName) { setGoal(null); return; }
    let alive = true;
    void getJson(`/api/forge/goal_profile?goal=${encodeURIComponent(goalName)}`).then((g) => { if (alive) setGoal(g); });
    return () => { alive = false; };
  }, [goalName]);

  const part = partNode ? parts[partNode] ?? null : null;
  const partColor = seriesColor(current ? programs.indexOf(current) : 0, theme);
  const s0 = part?.s ?? goal?.s ?? [];
  const x = cut ?? (s0.length ? s0[Math.floor(s0.length / 2)] : 0);

  // How far the part is from the goal over the length they share.
  const misfit = useMemo(() => {
    if (!part || !goal) return null;
    let worst = 0, where = 0, sum = 0, n = 0;
    for (let i = 0; i < part.s.length; i++) {
      const g = at(goal, measure, part.s[i]);
      if (g === null) continue;
      const d = part[measure][i] - g;
      sum += Math.abs(d); n++;
      if (Math.abs(d) > Math.abs(worst)) { worst = d; where = part.s[i]; }
    }
    return n ? { worst, where, mean: sum / n } : null;
  }, [part, goal, measure]);

  if (!partNode && !goal) {
    return <div className="p-3 text-xs text-gray-500">Cook a program (or pick a goal) to see its profile.</div>;
  }
  const label = (id: string) => {
    const l = nodes.find((n) => n.id === id)?.data.params.label;
    return typeof l === "string" && l ? l : id;
  };
  const c = CHROME[theme];
  const lines: Plotly.Data[] = [];
  if (goal) lines.push({ x: goal.s, y: goal[measure], name: `goal ${goalName}`, type: "scatter", mode: "lines",
                         line: { color: GOAL_COLOR, width: 1.5, dash: "dash" } });
  for (const p of pinnedLast) {
    const prof = parts[p.id];
    if (prof) lines.push({ x: prof.s, y: prof[measure], name: label(p.id), type: "scatter", mode: "lines",
                           line: { color: p.color, width: 1.2 } });
  }
  if (part) lines.push({ x: part.s, y: part[measure], name: label(partNode!), type: "scatter", mode: "lines",
                         line: { color: partColor, width: 2 } });

  // the cross-section at x: y = r cos(theta), z = r sin(theta) (the slab convention)
  const ring = (p: Profile) => {
    const r = p.r[nearest(p.s, x)];
    const xs = r.map((v, k) => v * Math.sin((2 * Math.PI * k) / p.n_theta));
    const ys = r.map((v, k) => v * Math.cos((2 * Math.PI * k) / p.n_theta));
    return { x: [...xs, xs[0]], y: [...ys, ys[0]] }; // closed
  };
  const sections: Plotly.Data[] = [];
  if (goal && at(goal, "d_eq", x) !== null) sections.push({ ...ring(goal), name: "goal", type: "scatter", mode: "lines",
                                                     line: { color: GOAL_COLOR, dash: "dash", width: 1.5 } });
  for (const p of pinnedLast) {
    const prof = parts[p.id];
    if (prof && at(prof, "d_eq", x) !== null) sections.push({ ...ring(prof), name: label(p.id), type: "scatter", mode: "lines",
                                                         line: { color: p.color, width: 1.2 } });
  }
  if (part && at(part, "d_eq", x) !== null) sections.push({ ...ring(part), name: label(partNode!), type: "scatter", mode: "lines",
                                                     fill: "toself", fillcolor: `${partColor}33`, line: { color: partColor, width: 2 } });

  const readout = (key: Measure) => {
    const a = part ? at(part, key, x) : null;
    const g = goal ? at(goal, key, x) : null;
    return (
      <div key={key} className="flex gap-2">
        <span className="text-gray-500 w-16">{key === "d_eq" ? "size" : key === "thick" ? "thickness" : "width"}</span>
        <span className="text-gray-100 w-12 text-right">{a === null ? "—" : a.toFixed(2)}</span>
        <span className="text-gray-400 w-12 text-right">{g === null ? "—" : g.toFixed(2)}</span>
        <span className={`w-12 text-right ${a !== null && g !== null && Math.abs(a - g) > 0.5 ? "text-amber-300" : "text-gray-500"}`}>
          {a !== null && g !== null ? `${a - g > 0 ? "+" : ""}${(a - g).toFixed(2)}` : ""}
        </span>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto text-xs text-gray-300">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <select value={measure} onChange={(e) => setMeasure(e.target.value as Measure)} aria-label="Measure"
                className="bg-surface border border-border rounded px-1.5 py-0.5 text-gray-200">
          {(Object.keys(MEASURES) as Measure[]).map((k) => <option key={k} value={k}>{MEASURES[k]}</option>)}
        </select>
        <span className="text-gray-500 truncate flex-1 text-right">
          {partNode ? label(partNode) : "no part"}{goalName ? ` vs goal ${goalName}` : ""}
        </span>
      </div>
      {misfit && (
        <div className="px-3 py-1.5 border-b border-border text-[11px] tabular-nums">
          {MEASURES[measure]} vs goal: worst <span className={Math.abs(misfit.worst) > 0.5 ? "text-amber-300" : "text-gray-100"}>
            {misfit.worst > 0 ? "+" : ""}{misfit.worst.toFixed(2)} mm</span> at {misfit.where.toFixed(1)} mm,
          mean |Δ| {misfit.mean.toFixed(2)} mm
          {goal && part ? ` · length ${(part.s[part.s.length - 1] - part.s[0]).toFixed(1)} vs ${(goal.s[goal.s.length - 1] - goal.s[0]).toFixed(1)} mm` : ""}
        </div>
      )}
      <div ref={plotRef} className="h-56 shrink-0">
        <Plot
          data={lines}
          layout={{
            ...(plotLayout(theme, 10) as Partial<Plotly.Layout>),
            margin: { t: 8, r: 10, b: 32, l: 40 }, showlegend: false, hovermode: "x unified",
            xaxis: { ...plotAxis(theme), title: { text: "along the bar (mm)" } },
            yaxis: { ...plotAxis(theme), title: { text: "mm" } },
            shapes: [{ type: "line", x0: x, x1: x, yref: "paper", y0: 0, y1: 1, line: { color: c.ink, width: 1, dash: "dot" } }],
          }}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
          onClick={(e) => { const px = e.points?.[0]?.x; if (typeof px === "number") setCut(px); }}
        />
      </div>
      <div className="px-3 py-1.5 flex items-center gap-2 border-t border-border">
        <span className="text-gray-500 shrink-0">section at</span>
        <input type="range" className="flex-1 accent-accent" min={s0[0] ?? 0} max={s0[s0.length - 1] ?? 1} step={0.1}
               value={x} onChange={(e) => setCut(Number(e.target.value))} />
        <span className="tabular-nums w-16 text-right">{x.toFixed(1)} mm</span>
      </div>
      <div className="flex gap-3 px-3 pb-3 items-start">
        <div className="w-36 h-36 shrink-0">
          <Plot
            data={sections}
            layout={{
              ...(plotLayout(theme, 9) as Partial<Plotly.Layout>),
              margin: { t: 4, r: 4, b: 20, l: 26 }, showlegend: false, hovermode: false,
              xaxis: { ...plotAxis(theme), zeroline: true },
              yaxis: { ...plotAxis(theme), zeroline: true, scaleanchor: "x" },
            }}
            config={{ responsive: true, displayModeBar: false, staticPlot: true }}
            style={{ width: "100%", height: "100%" }}
            useResizeHandler
          />
        </div>
        <div className="tabular-nums text-[11px] flex flex-col gap-0.5 pt-2">
          <div className="flex gap-2 text-gray-500">
            <span className="w-16" /><span className="w-12 text-right">part</span>
            <span className="w-12 text-right">goal</span><span className="w-12 text-right">Δ</span>
          </div>
          {(["d_eq", "thick", "wide"] as Measure[]).map(readout)}
          <div className="text-[10px] text-gray-500 mt-1">mm · click the plot or drag to move the section</div>
        </div>
      </div>
    </div>
  );
}
