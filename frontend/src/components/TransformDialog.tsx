import { useState } from "react";
import type { GeneratorSchema, ParamValue, TransformResponse } from "@/types/pipeline";
import { usePipelineStore } from "@/stores/pipelineStore";
import { ParamControl } from "./ParamControl";

// Runs a server-side path transform on the CURRENT linear chain (e.g.
// "fill_heats": insert reheats where the program would forge too cold),
// loads the rewritten path and shows what changed.
export function TransformDialog({ schema, onClose }: { schema: GeneratorSchema; onClose: () => void }) {
  const exportProgram = usePipelineStore((s) => s.exportProgram);
  const loadPath = usePipelineStore((s) => s.loadPath);
  const [params, setParams] = useState<Record<string, ParamValue>>(() =>
    Object.fromEntries(Object.entries(schema.params).map(([k, spec]) => [k, spec.default])),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Record<string, unknown>[] | null>(null);

  async function handleRun() {
    // the current program as a path (its controllers baked into their steps)
    const { path, error: why } = await exportProgram();
    if (!path) {
      setError(why ?? "The graph must be a single linear chain (a path) to transform.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/transforms/${encodeURIComponent(schema.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, params }),
      });
      const data: TransformResponse = await res.json();
      if (!data.ok || !data.path) {
        setError(data.error ?? "transform failed");
      } else {
        loadPath(data.path);
        setReport(data.report ?? []);
      }
    } catch (e) {
      setError(String(e));
    }
    setRunning(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-96 max-h-[80vh] overflow-y-auto rounded-md border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-sm text-gray-200 font-medium">Transform: {schema.name}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xs">✕</button>
        </div>
        {report === null ? (
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
            {error && <div className="text-xs text-red-400">{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-xs px-3 py-1 rounded border border-border text-gray-400 hover:text-gray-100">
                Cancel
              </button>
              <button
                onClick={handleRun}
                disabled={running}
                className="text-xs px-3 py-1 rounded bg-accent text-white disabled:opacity-50"
              >
                {running ? "Simulating…" : "Apply"}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-3 py-3 flex flex-col gap-2 text-xs">
            <div className="text-gray-200">
              {report.length === 0 ? "Nothing to change." : `${report.length} step${report.length === 1 ? "" : "s"} inserted:`}
            </div>
            {report.map((r, i) => (
              <div key={i} className="rounded border border-border px-2 py-1 text-gray-300">
                <div>
                  before <span className="text-gray-100 font-medium">{String(r.before ?? "")}</span>
                </div>
                {r.reason !== undefined && <div className="text-gray-500">{String(r.reason)}</div>}
              </div>
            ))}
            <div className="flex justify-end">
              <button onClick={onClose} className="text-xs px-3 py-1 rounded bg-accent text-white">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
