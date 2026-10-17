import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { usePipelineStore } from "@/stores/pipelineStore";
import { type FieldSpec, type SettingValue, TERMINAL, methodSpec, useSearchStore } from "@/stores/searchStore";
import { plotLayout, useResolvedTheme } from "@/theme";
import { colormap } from "@/utils/colormap";
import { ScalarPanel } from "./ScalarPanel";

// The side panel's "Sequence search" tab: pick a search method (MAP-Elites,
// the cogging controller, ...), set its settings (the form comes from the
// server's schema), run it toward the goal mesh. MAP-Elites shows its archive
// (click an elite to open it) and polished elites; a controller shows its one
// program's result. Results open as paths, reheats filled in, ready to polish
// in the Optimize tab.

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex items-center mb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">{title}</span>
        <div className="ml-auto flex gap-1">{right}</div>
      </div>
      {children}
    </div>
  );
}

const field = "bg-surface border border-border rounded px-1 py-0.5 text-gray-200 tabular-nums disabled:opacity-40";
const smallBtn =
  "text-[10px] px-1.5 py-0.5 rounded border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors disabled:opacity-40";

function FieldInput({ f, value, disabled, onChange }: {
  f: FieldSpec; value: SettingValue; disabled: boolean; onChange: (v: SettingValue) => void;
}) {
  if (f.kind === "bool") {
    return <input type="checkbox" className="accent-accent justify-self-start" checked={Boolean(value)} disabled={disabled}
                  aria-label={f.label} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (f.kind === "select") {
    return (
      <select value={String(value)} disabled={disabled} aria-label={f.label} onChange={(e) => onChange(e.target.value)}
              className={`${field} min-w-0`}>
        {Object.entries(f.options ?? {}).map(([k, text]) => <option key={k} value={k}>{text}</option>)}
      </select>
    );
  }
  if (f.kind === "multiselect") {
    const picked = Array.isArray(value) ? value : [];
    const [lo, hi] = f.count ?? [1, Object.keys(f.options ?? {}).length];
    return (
      <div className="flex flex-col">
        {Object.entries(f.options ?? {}).map(([k, text]) => {
          const on = picked.includes(k);
          return (
            <label key={k} className="flex items-center gap-2 py-0.5">
              <input type="checkbox" className="accent-accent" checked={on} disabled={disabled || (!on && picked.length >= hi)}
                     onChange={() => {
                       const next = on ? picked.filter((x) => x !== k) : [...picked, k];
                       if (next.length >= lo) onChange(next);
                     }} />
              <span className="text-gray-200">{text}</span>
            </label>
          );
        })}
      </div>
    );
  }
  return (
    <input type="number" value={Number(value)} min={f.min} max={f.max} step={f.step ?? (f.kind === "int" ? 1 : "any")}
           disabled={disabled} aria-label={f.label} className={field}
           onChange={(e) => {
             let v = Number(e.target.value);
             if (f.min !== undefined) v = Math.max(f.min, v);
             if (f.max !== undefined) v = Math.min(f.max, v);
             onChange(f.kind === "int" ? Math.round(v) : v);
           }} />
  );
}

const RESULT_ROWS: [string, string, (v: number | boolean) => string][] = [
  ["radial_mm", "radial distance to the goal", (v) => `${Number(v).toFixed(2)} mm`],
  ["size_mean_mm", "diameter error, mean", (v) => `${Number(v).toFixed(2)} mm`],
  ["size_max_mm", "diameter error, worst", (v) => `${Number(v).toFixed(2)} mm`],
  ["length_error_mm", "length vs the goal", (v) => `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)} mm`],
  ["hits", "hits", (v) => String(v)],
  ["finishing_hits", "of them finishing", (v) => String(v)],
  ["cycles", "cycles", (v) => String(v)],
  ["feasible", "every hit feasible", (v) => (v ? "yes" : "no")],
];

export function SearchPanel() {
  const goalName = usePipelineStore((s) => s.goalName);
  const { schema, method, settings, status, error, loading, loadSchema, setMethod, setSetting, start, stop, open,
          openMode, setOpenMode } = useSearchStore();
  useEffect(() => void loadSchema(), [loadSchema]);
  const theme = useResolvedTheme();
  const running = !!status && !TERMINAL.includes(status.state);
  const spec = methodSpec(schema, method);
  const values = settings[method ?? ""] ?? {};

  // MAP-Elites' archive axes: its descriptors, labelled from its own field
  const descField = methodSpec(schema, "map_elites")?.fields.find((f) => f.name === "descriptors");
  const descriptorLabel = (d: string) => descField?.options?.[d] ?? d;
  const descs = status?.descriptors ?? [];
  const [axes, setAxes] = useState<[number, number]>([0, 1]);
  const ax: [number, number] = [Math.min(axes[0], descs.length - 1), Math.min(axes[1], descs.length - 1)];
  const colorscale = useMemo(() => { // best (lowest loss) = the most salient end of the sequential ramp
    const f = colormap("sequential", theme);
    return [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const [r, g, b] = f(t);
      return [1 - t, `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)})`];
    }).reverse();
  }, [theme]);
  const archive = status?.archive?.cells ? status.archive : undefined; // the server sends {} before the first snapshot

  if (!schema) {
    return <div className="p-3 text-xs text-gray-500">No search methods: the server has none of their engines installed.</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto text-xs text-gray-300">
      <Section title="Sequence search">
        <div className="flex items-center gap-2">
          <select value={method ?? ""} disabled={running} aria-label="Search method" onChange={(e) => setMethod(e.target.value)}
                  className={`${field} min-w-0 flex-1`}>
            {schema.methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          {running ? (
            <button onClick={stop} className="px-3 py-1 rounded bg-red-600 text-white text-xs">Stop</button>
          ) : (
            <button onClick={start} disabled={!goalName || !spec} className="px-3 py-1 rounded bg-accent text-white text-xs disabled:opacity-40">
              ▶ Run
            </button>
          )}
        </div>
        {spec && <div className="mt-1 text-[10px] text-gray-500">{spec.description}</div>}
        <div className="mt-1 text-gray-500 truncate">goal: {goalName ?? "pick one under Render settings"}</div>
        {error && <div className="mt-1.5 text-red-400 break-words">{error}</div>}
        {status && (
          <div className="mt-1.5 flex flex-col gap-0.5 tabular-nums">
            <div>
              <span className="text-gray-100">{status.state}</span>
              {status.state === "compiling" && <span className="text-gray-500"> — about half a minute</span>}
              <span className="text-gray-500"> · {status.iteration}/{status.iterations}</span>
              <span className="text-gray-500"> · {methodSpec(schema, status.method)?.label ?? status.method}</span>
            </div>
            {status.phase && running && <div className="text-gray-500">{status.phase}</div>}
            {typeof status.best_loss === "number" && (
              <div>
                {status.progress_label ?? "best"} {status.best_loss.toFixed(2)}
                {typeof status.coverage === "number" && <> · {(status.coverage * 100).toFixed(0)}% of the archive filled</>}
                {typeof status.best_polished_loss === "number" && (
                  <span className="text-green-400"> · polished {status.best_polished_loss.toFixed(2)} mm</span>
                )}
              </div>
            )}
            {status.state === "error" && <div className="text-red-400 break-words">{status.error}</div>}
            {status.state !== "error" && status.error && (
              <div className="text-amber-400 break-words">⚠ {status.error} — the results so far are kept</div>
            )}
          </div>
        )}
      </Section>

      {status?.tag && (
        <div className="h-40 shrink-0 border-b border-border">
          <ScalarPanel run={schema.run} tag={status.tag} shortNames />
        </div>
      )}

      {status && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border text-[10px]"
             title="Replace: the opened program becomes the graph. Add: it goes beside what's there, as its own chain (to compare).">
          <span className="text-gray-500 mr-1">Results open</span>
          {(["replace", "add"] as const).map((m) => (
            <button key={m} onClick={() => setOpenMode(m)}
                    className={`px-1.5 py-0.5 rounded border transition-colors ${
                      openMode === m ? "bg-accent border-accent text-white" : "border-border text-gray-400 hover:border-accent"}`}>
              {m === "replace" ? "replacing the graph" : "beside it"}
            </button>
          ))}
        </div>
      )}

      {status?.result && (
        <Section title="Result" right={
          <button onClick={() => open({})} disabled={loading || running} className={smallBtn}>Open program</button>
        }>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums">
            {RESULT_ROWS.filter(([k]) => k in (status.result ?? {})).map(([k, label, fmt]) => (
              <div key={k} className="contents">
                <span className="text-gray-500">{label}</span>
                <span className="text-gray-200">{fmt(status.result![k])}</span>
              </div>
            ))}
          </div>
          {loading && <div className="text-gray-500 mt-1">opening the program…</div>}
        </Section>
      )}

      {archive && archive.cells.length > 0 && (
        <Section
          title={`Archive (${archive.cells.length} elites) — click one to open it`}
          right={
            <>
              {[0, 1].map((k) => (
                <select key={k} value={ax[k]} aria-label={k ? "y axis" : "x axis"}
                        onChange={(e) => setAxes((a) => (k ? [a[0], Number(e.target.value)] : [Number(e.target.value), a[1]]))}
                        className={`${field} text-[10px]`}>
                  {descs.map((d, i) => <option key={d} value={i}>{k ? "y" : "x"}: {d}</option>)}
                </select>
              ))}
            </>
          }
        >
          <div className="h-60">
            <Plot
              data={[{
                type: "scattergl", mode: "markers",
                x: archive.descriptors.map((d) => d[ax[0]]), y: archive.descriptors.map((d) => d[ax[1]]),
                customdata: archive.cells,
                text: archive.loss.map((l) => `${l.toFixed(2)} mm`),
                hovertemplate: "loss %{text}<br>%{xaxis.title.text}: %{x:.2f}<br>%{yaxis.title.text}: %{y:.2f}<extra>cell %{customdata}</extra>",
                marker: { size: 7, color: archive.loss, colorscale, showscale: true,
                          colorbar: { title: { text: "mm", side: "right" }, thickness: 8 } },
              } as Plotly.Data]}
              layout={{
                ...plotLayout(theme),
                margin: { t: 6, r: 6, b: 34, l: 40 },
                xaxis: { ...(plotLayout(theme).xaxis as object), title: { text: descriptorLabel(descs[ax[0]]) } },
                yaxis: { ...(plotLayout(theme).yaxis as object), title: { text: descriptorLabel(descs[ax[1]]) } },
                uirevision: status?.job_id,
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%", height: "100%" }}
              useResizeHandler
              onClick={(e) => {
                const cell = e.points?.[0]?.customdata;
                if (typeof cell === "number" && !running && !loading) open({ cell });
              }}
            />
          </div>
          {running && <div className="text-[10px] text-gray-600">Elites open once the search has finished.</div>}
        </Section>
      )}

      {!!status?.polished?.length && (
        <Section title="Polished elites (gradient polish of the best)">
          <div className="max-h-40 overflow-y-auto pr-1">
            {status.polished.slice(0, 12).map((e, rank) => (
              <div key={e.index} className="flex items-center gap-2 py-0.5 tabular-nums">
                <span className="text-gray-500 w-5">{rank + 1}</span>
                <span className="text-gray-200">{e.loss.toFixed(2)} mm</span>
                <span className="text-gray-500">from {e.archive_loss.toFixed(2)}</span>
                <span className="text-gray-500 truncate">
                  {e.descriptors.map((v, i) => `${descs[i]} ${v.toFixed(1)}`).join(" · ")}
                </span>
                <button onClick={() => open({ polished: e.index })} disabled={loading} className={`ml-auto ${smallBtn}`}>
                  Open
                </button>
              </div>
            ))}
          </div>
          {loading && <div className="text-gray-500 mt-1">opening the program…</div>}
        </Section>
      )}

      {spec && (
        <Section title={`Settings — ${spec.label}`}>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 items-center">
            {spec.fields.map((f) => (
              <div key={f.name} className="contents">
                <span title={f.help} className={f.kind === "multiselect" ? "self-start pt-0.5" : undefined}>{f.label}</span>
                <FieldInput f={f} value={values[f.name] ?? (f.default as SettingValue)} disabled={running}
                            onChange={(v) => setSetting(f.name, v)} />
              </div>
            ))}
          </div>
          <div className="text-[10px] text-gray-600 mt-1">
            Isothermal; the part's stock comes from the graph (else the real-scale D40×59).
          </div>
        </Section>
      )}
    </div>
  );
}
