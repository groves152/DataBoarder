import { useState } from "react";
import type { GeneratorSchema, GenerateResponse, ParamValue } from "@/types/pipeline";
import { usePipelineStore } from "@/stores/pipelineStore";
import { ParamControl } from "./ParamControl";

function defaultParams(schema: GeneratorSchema): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  for (const [name, spec] of Object.entries(schema.params)) params[name] = spec.default;
  return params;
}

export function GenerateDialog({ schema, onClose }: { schema: GeneratorSchema; onClose: () => void }) {
  const loadPath = usePipelineStore((s) => s.loadPath);
  const [params, setParams] = useState<Record<string, ParamValue>>(() => defaultParams(schema));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/generators/${encodeURIComponent(schema.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data: GenerateResponse = await res.json();
      if (!data.ok || !data.path) {
        setError(data.error ?? "generate failed");
        setGenerating(false);
        return;
      }
      loadPath(data.path);
      onClose();
    } catch (e) {
      setError(String(e));
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-80 max-h-[80vh] overflow-y-auto rounded-md border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-sm text-gray-200 font-medium">Generate: {schema.name}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xs">✕</button>
        </div>
        <div className="px-3 py-3 flex flex-col gap-4">
          {Object.entries(schema.params).map(([name, spec]) => (
            <ParamControl
              key={name}
              name={name}
              spec={spec}
              value={params[name] ?? spec.default}
              onChange={(v) => setParams((p) => ({ ...p, [name]: v }))}
            />
          ))}
        </div>
        {error && <div className="px-3 pb-2 text-[11px] text-red-400 break-words">{error}</div>}
        <div className="px-3 py-2 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 rounded bg-surface border border-border text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs px-3 py-1 rounded bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
