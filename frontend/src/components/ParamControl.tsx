import type { ParamSpec, ParamValue } from "@/types/pipeline";

// One editable control for a `ParamSpec` -- slider/dropdown/checkbox,
// generic across any param the backend describes. Shared by NodeInspector
// (editing a graph node's params) and GenerateDialog (filling in a path
// generator's params before running it) -- same rendering rules either way.
export function ParamControl({
  name, spec, value, onChange, formatValue,
}: {
  name: string;
  spec: ParamSpec;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
  // Overrides the numeric readout next to a float slider (e.g. showing
  // phi in radians as "π/2" instead of "1.57") -- ignored for int/select/
  // bool. Optional, defaults to the plain 2-decimal display.
  formatValue?: (v: number) => string;
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
  const step = spec.step ?? (spec.type === "int" ? 1 : 0.1);
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
        min={spec.min ?? 0}
        max={spec.max ?? 100}
        step={step}
        value={numValue}
        onChange={(e) => onChange(spec.type === "int" ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
        className="accent-accent"
      />
    </label>
  );
}
