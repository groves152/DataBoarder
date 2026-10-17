import type { ParamSpec, ParamValue } from "@/types/pipeline";

// One editable control for a `ParamSpec` -- slider/dropdown/checkbox,
// generic across any param the backend describes. Shared by NodeInspector
// (editing a graph node's params) and GenerateDialog (filling in a path
// generator's params before running it) -- same rendering rules either way.
// The browser's range thumb travels between half a thumb in from each end,
// so tick bullets are inset by the same amount to sit under its stops.
const THUMB_PX = 16;

export function ParamControl({
  name, spec, value, onChange, formatValue, ticks,
}: {
  name: string;
  spec: ParamSpec;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
  // Overrides the numeric readout next to a float slider (e.g. showing
  // phi in radians as "π/2" instead of "1.57") -- ignored for int/select/
  // bool. Optional, defaults to the plain 2-decimal display.
  formatValue?: (v: number) => string;
  // Discrete stops for a float slider (e.g. a strike angle under a symmetry
  // preset): it snaps between them, with a labelled bullet under each (click
  // one to jump there). Assumed evenly spaced from `spec.min`.
  ticks?: number[];
}) {
  const label = spec.label ?? name;
  const title = spec.description;

  if (spec.type === "bool") {
    return (
      <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer" title={title}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-accent"
        />
        <span className={title ? "border-b border-dotted border-gray-600" : undefined}>{label}</span>
      </label>
    );
  }

  if (spec.type === "select") {
    return (
      <label className="flex flex-col gap-1 text-xs text-gray-400" title={title}>
        <span>{label}</span>
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="bg-surface border border-border rounded px-2 py-1 text-gray-200"
        >
          {(spec.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </label>
    );
  }

  const numValue = typeof value === "number" ? value : Number(value);
  const lo = spec.min ?? 0;
  const hi = spec.max ?? 100;
  const step = ticks && ticks.length > 1 ? ticks[1] - ticks[0] : spec.step ?? (spec.type === "int" ? 1 : 0.1);
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-400" title={title}>
      <span className="flex justify-between">
        <span className={title ? "border-b border-dotted border-gray-600" : undefined}>{label}</span>
        <span className="tabular-nums text-gray-300">
          {spec.type === "int" ? numValue : formatValue ? formatValue(numValue) : numValue.toFixed(2)}
        </span>
      </span>
      <input
        type="range"
        min={lo}
        max={hi}
        step={step}
        value={numValue}
        onChange={(e) => onChange(spec.type === "int" ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
        className="accent-accent"
      />
      {ticks && (
        <div className="relative h-6 -mt-0.5">
          {ticks.map((t) => {
            const f = (t - lo) / (hi - lo || 1);
            const on = Math.abs(t - numValue) < 1e-6;
            return (
              <button
                key={t}
                type="button"
                onClick={(e) => { e.preventDefault(); onChange(t); }}
                style={{ left: `calc(${f * 100}% + ${(0.5 - f) * THUMB_PX}px)` }}
                className="absolute top-0 -translate-x-1/2 flex flex-col items-center gap-0.5 group"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-accent" : "bg-gray-500 group-hover:bg-gray-300"}`} />
                <span className={`text-[9px] leading-none tabular-nums ${on ? "text-gray-200" : "text-gray-500"}`}>
                  {formatValue ? formatValue(t) : t.toFixed(2)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </label>
  );
}
