import { useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { toast } from "@/stores/toastStore";

// Floats over the viewport while a goal mesh is edited (StartGoalPicker's
// "Edit…", and right after an upload): units, orientation, scale (all axes or
// each), a volume to scale to, and where the mesh sits. Server: forge-genie's
// goals.py -- every edit re-runs one transform on the goal's source mesh (the
// file as uploaded), so edits never compound; each change is previewed in the
// viewport (in the goal's place) until applied.

export interface GoalTransform {
  units: "mm" | "cm" | "m" | "inch";
  principal: boolean;
  rotate_deg: [number, number, number];
  flip: boolean;
  uniform: number;
  aspect: [number, number, number];
  volume_mm3: number | null;
  volume_mode: "uniform" | "length";
  place: "grip_origin" | "centroid" | "none";
}

interface MeshInfo { extents_mm: [number, number, number]; volume_mm3: number; closed: boolean; vertices: number; faces: number }

const UNITS: [GoalTransform["units"], string][] = [["mm", "mm"], ["cm", "cm"], ["m", "m"], ["inch", "in"]];
const PLACES: [GoalTransform["place"], string][] = [
  ["grip_origin", "grip end at the origin"], ["centroid", "x from 0, on the centroid"], ["none", "as it is"],
];
const AXES = ["x", "y", "z"] as const;

const btn = "px-1.5 py-0.5 rounded border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors disabled:opacity-40";
const seg = (on: boolean) => `px-1.5 py-0.5 rounded border transition-colors ${
  on ? "bg-accent border-accent text-white" : "border-border text-gray-400 hover:border-accent"}`;
const num = "w-full min-w-0 bg-surface border border-border rounded px-1 py-0.5 text-gray-200 tabular-nums";
const fmt = (v: number, d = 1) => v.toLocaleString(undefined, { maximumFractionDigits: d });
const dims = (e: number[], d = 1) => e.map((x) => fmt(x, d)).join(" × ");

function Row({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr] items-center gap-2" title={title}>
      <span className="text-gray-500">{label}</span>
      <div className="flex items-center gap-1 min-w-0">{children}</div>
    </div>
  );
}

function NumberBox({ value, onChange, step, min, label, suffix }: {
  value: number; onChange: (v: number) => void; step: number; min?: number; label: string; suffix?: string;
}) {
  // a draft while typing ("1." isn't a number yet); committed when it parses
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(+value.toFixed(6))), [value]);
  return (
    <span className="flex items-center gap-0.5 min-w-0 flex-1">
      <input type="number" value={draft} step={step} min={min} aria-label={label} className={num}
             onChange={(e) => {
               setDraft(e.target.value);
               const v = Number(e.target.value);
               if (e.target.value !== "" && Number.isFinite(v) && (min === undefined || v >= min)) onChange(v);
             }} />
      {suffix && <span className="text-gray-500 shrink-0">{suffix}</span>}
    </span>
  );
}

export function GoalEditor({ name }: { name: string }) {
  const { nodes, setGoalEditing, setGoalPreview, setGoalName, fetchAvailableGoals } = usePipelineStore();
  const [loaded, setLoaded] = useState<{ user: boolean; transform: GoalTransform; source_file: string; source: MeshInfo } | null>(null);
  const [t, setT] = useState<GoalTransform | null>(null);
  const [info, setInfo] = useState<MeshInfo | null>(null);
  const [saveAs, setSaveAs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previewTag = useRef<string | null>(null);

  const stock = nodes.find((n) => n.data.kind === "ops_stock")?.data.params;
  const stockVol = stock && typeof stock.radius === "number" && typeof stock.length === "number"
    ? Math.PI * stock.radius ** 2 * stock.length : null;

  useEffect(() => {
    let live = true;
    setLoaded(null); setT(null); setInfo(null); setError(null);
    fetch(`/api/forge/goals/${encodeURIComponent(name)}/edit`).then((r) => r.json()).then((d) => {
      if (!live) return;
      if (!d.ok) { setError(d.error ?? "couldn't load the goal"); return; }
      setLoaded(d); setT(d.transform); setInfo(d.info);
      setSaveAs(d.user ? "" : `${name}_edit`);
    }).catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [name]);

  // each change previewed (after a pause, so typing doesn't flood the server)
  useEffect(() => {
    if (!t || !loaded) return;
    const timer = setTimeout(async () => {
      const r = await fetch(`/api/forge/goals/${encodeURIComponent(name)}/transform`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transform: t }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setError(d.error ?? `HTTP ${r.status}`); return; }
      setError(null); setInfo(d.info);
      previewTag.current = d.tag;
      setGoalPreview(d.tag);
    }, 200);
    return () => clearTimeout(timer);
  }, [t, loaded, name, setGoalPreview]);

  const close = async () => {
    setGoalPreview(null);
    setGoalEditing(null);
    if (previewTag.current) await fetch(`/api/forge/goals/${encodeURIComponent(name)}/preview`, { method: "DELETE" });
  };

  const apply = async () => {
    if (!t) return;
    setBusy(true);
    const out = saveAs.trim() || name;
    const r = await fetch(`/api/forge/goals/${encodeURIComponent(name)}/transform`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transform: t, apply: true, save_as: out === name ? undefined : out }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || !d.ok) { setError(d.error ?? `HTTP ${r.status}`); return; }
    toast({ text: `Goal "${d.name}": ${dims(info?.extents_mm ?? [])} mm, ${fmt(d.volume_mm3, 0)} mm³`, tone: "success" });
    previewTag.current = null; // applying dropped it
    setGoalPreview(null);
    setGoalEditing(null);
    await fetchAvailableGoals();
    if (d.name !== usePipelineStore.getState().goalName) setGoalName(d.name);
  };

  const set = (patch: Partial<GoalTransform>) => setT((cur) => (cur ? { ...cur, ...patch } : cur));
  const turn = (k: number, by: number) => t && set({
    rotate_deg: t.rotate_deg.map((a, i) => (i === k ? ((a + by + 540) % 360) - 180 : a)) as [number, number, number],
  });

  return (
    <div className="w-80 max-h-full overflow-y-auto flex flex-col gap-2 rounded border border-border bg-panel/95 p-2.5 text-xs text-gray-300 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">Edit goal</span>
        <span className="text-gray-100 truncate">{name}</span>
        <button className="ml-auto text-gray-500 hover:text-gray-100" onClick={() => void close()} title="Close without applying">✕</button>
      </div>
      {loaded && (
        <div className="text-[10px] text-gray-500">
          from {loaded.source_file} · {dims(loaded.source.extents_mm, 2)} in the file's units
          {!loaded.source.closed && <span className="text-amber-400"> · ⚠ not a closed surface: the volume is rough</span>}
        </div>
      )}
      {error && <div className="text-red-400 break-words">{error}</div>}
      {t && (
        <>
          <Row label="Units" title="What one unit in the file is">
            {UNITS.map(([u, label]) => (
              <button key={u} className={seg(t.units === u)} onClick={() => set({ units: u })}>{label}</button>
            ))}
          </Row>
          <Row label="Orient" title="As is: the file's own axes. Longest axis: its longest principal axis onto x (it leans if the part's bulk is off its bar's axis)">
            <button className={seg(!t.principal)} onClick={() => set({ principal: false })}>as is</button>
            <button className={seg(t.principal)} onClick={() => set({ principal: true })}>longest axis → x</button>
            <button className={seg(t.flip)} onClick={() => set({ flip: !t.flip })} title="Half a turn about z: the other end is the grip end">
              flip ends
            </button>
          </Row>
          {AXES.map((a, k) => (
            <Row key={a} label={k === 0 ? "Turn" : ""} title="Degrees about each axis (x, then y, then z)">
              <span className="w-3 text-gray-500">{a}</span>
              <button className={btn} onClick={() => turn(k, -90)} title={`−90° about ${a}`}>⟲</button>
              <NumberBox value={t.rotate_deg[k]} step={1} label={`Turn about ${a}`} suffix="°"
                         onChange={(v) => set({ rotate_deg: t.rotate_deg.map((x, i) => (i === k ? v : x)) as [number, number, number] })} />
              <button className={btn} onClick={() => turn(k, 90)} title={`+90° about ${a}`}>⟳</button>
            </Row>
          ))}
          <Row label="Scale" title="All axes, then each (along the turned axes: x is the bar's)">
            <NumberBox value={t.uniform} step={0.01} min={1e-6} label="Scale, all axes" suffix="×" onChange={(v) => set({ uniform: v })} />
          </Row>
          <Row label="Aspect">
            {AXES.map((a, k) => (
              <NumberBox key={a} value={t.aspect[k]} step={0.01} min={1e-6} label={`Scale along ${a}`} suffix={a}
                         onChange={(v) => set({ aspect: t.aspect.map((x, i) => (i === k ? v : x)) as [number, number, number] })} />
            ))}
          </Row>
          <Row label="Volume" title="Scale to this volume after the rest: all axes alike, or the length (x) only, keeping its sections">
            <input type="checkbox" className="accent-accent" checked={t.volume_mm3 !== null} aria-label="Scale to a volume"
                   onChange={(e) => set({ volume_mm3: e.target.checked ? Math.round(info?.volume_mm3 ?? 1000) : null })} />
            {t.volume_mm3 !== null ? (
              <>
                <NumberBox value={t.volume_mm3} step={100} min={1} label="Volume" suffix="mm³" onChange={(v) => set({ volume_mm3: v })} />
                <select value={t.volume_mode} aria-label="How to scale to the volume"
                        onChange={(e) => set({ volume_mode: e.target.value as GoalTransform["volume_mode"] })}
                        className="bg-surface border border-border rounded px-1 py-0.5 text-gray-200">
                  <option value="uniform">all axes</option>
                  <option value="length">length</option>
                </select>
              </>
            ) : <span className="text-gray-500">as scaled</span>}
            {stockVol && (
              <button className={btn} title={`The graph's stock: ${fmt(stockVol, 0)} mm³`}
                      onClick={() => set({ volume_mm3: Math.round(stockVol) })}>= stock</button>
            )}
          </Row>
          <Row label="Place" title="Where the mesh sits: the stock is held at its low-x end, on the x axis">
            <select value={t.place} aria-label="Place" onChange={(e) => set({ place: e.target.value as GoalTransform["place"] })}
                    className="bg-surface border border-border rounded px-1 py-0.5 text-gray-200 w-full">
              {PLACES.map(([p, label]) => <option key={p} value={p}>{label}</option>)}
            </select>
          </Row>
          {info && (
            <div className="rounded bg-surface px-2 py-1 tabular-nums">
              <div><span className="text-gray-500">size </span><span className="text-gray-100">{dims(info.extents_mm)} mm</span>
                <span className="text-gray-500"> (x × y × z)</span></div>
              <div><span className="text-gray-500">volume </span><span className="text-gray-100">{fmt(info.volume_mm3, 0)} mm³</span>
                {stockVol && <span className="text-gray-500"> · {(info.volume_mm3 / stockVol).toFixed(2)}× the graph's stock</span>}</div>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button className="px-2.5 py-1 rounded bg-accent text-white disabled:opacity-40" disabled={busy || (!loaded?.user && !saveAs.trim())}
                    onClick={() => void apply()} title={saveAs.trim() && saveAs.trim() !== name ? "Save as a new goal" : "Rewrite this goal"}>
              {saveAs.trim() && saveAs.trim() !== name ? "Save as" : "Apply"}
            </button>
            <input value={saveAs} onChange={(e) => setSaveAs(e.target.value)} aria-label="Save as"
                   placeholder={loaded?.user ? "or save as… (a name)" : "a name for your copy"}
                   className="flex-1 min-w-0 bg-surface border border-border rounded px-1.5 py-0.5 text-gray-200" />
            <button className={btn} onClick={() => loaded && setT(loaded.transform)} title="Back to how the goal was">Reset</button>
          </div>
          {loaded && !loaded.user && (
            <div className="text-[10px] text-gray-500">A library goal: the edit is saved as a goal of yours.</div>
          )}
        </>
      )}
    </div>
  );
}
