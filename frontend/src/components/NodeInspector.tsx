import { usePipelineStore } from "@/stores/pipelineStore";
import type { ParamSpec } from "@/types/pipeline";

function ParamControl({
  name, spec, value, onChange,
}: {
  name: string;
  spec: ParamSpec;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  const label = spec.label ?? name;

  if (spec.type === "select") {
    return (
      <label className="flex flex-col gap-1 text-xs text-gray-400">
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
    <label className="flex flex-col gap-1 text-xs text-gray-400">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-gray-300">
          {spec.type === "int" ? numValue : numValue.toFixed(2)}
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

export function NodeInspector() {
  const { nodes, nodeKinds, selectedNodeId, updateNodeParam, cooking, cookError } = usePipelineStore();
  const node = nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-500 p-4 text-center">
        Select a node to edit its parameters.
      </div>
    );
  }

  const schema = nodeKinds.find((k) => k.kind === node.data.kind);

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="px-3 py-2 border-b border-border">
        <div className="text-xs text-gray-500">{node.data.kind}</div>
        <div className="text-sm text-gray-200 font-medium">{node.id}</div>
        <div className={`text-[10px] mt-1 ${node.data.cooked ? "text-green-400" : "text-gray-500"}`}>
          {node.data.cooked ? "cooked" : "stale — will cook shortly"}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-4">
        {schema && Object.entries(schema.params).map(([name, spec]) => (
          <ParamControl
            key={name}
            name={name}
            spec={spec}
            value={node.data.params[name] ?? spec.default}
            onChange={(v) => updateNodeParam(node.id, name, v)}
          />
        ))}
        {!schema && (
          <div className="text-xs text-gray-500">Unknown node kind — no schema loaded.</div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-border text-[11px]">
        {cooking && <div className="text-accent">cooking…</div>}
        {cookError && <div className="text-red-400 break-words">{cookError}</div>}
      </div>
    </div>
  );
}
