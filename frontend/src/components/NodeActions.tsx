import { useEffect } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";

// A node's results as rows (its diagnostics' `rows`: [name, value] pairs), and
// a controller's actions -- the steps it chose, each clickable to show the
// part after it in the viewport (the replay plays them all; export bakes them).

export function NodeRows({ rows, idle }: { rows: [string, unknown][]; idle?: string }) {
  return (
    <div className="border-t border-border pt-3 text-[11px]">
      <div className="text-gray-500 uppercase tracking-wide text-[10px] mb-1">Result</div>
      {idle && <div className="text-amber-400 mb-1">⚠ {idle}</div>}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <span className="text-gray-500">{k}</span>
            <span className="text-gray-200 break-words">{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NodeActions({ nodeId }: { nodeId: string }) {
  const actions = usePipelineStore((s) => s.nodeActions[nodeId]);
  const fetchActions = usePipelineStore((s) => s.fetchActions);
  const actionView = usePipelineStore((s) => s.actionView);
  const showAction = usePipelineStore((s) => s.showAction);
  const cookEpoch = usePipelineStore((s) => s.cookEpoch);
  useEffect(() => void fetchActions(nodeId), [nodeId, cookEpoch, fetchActions]);
  const shown = actionView?.node === nodeId ? actionView.index : null;
  const list = Array.isArray(actions) ? actions : [];
  const step = (d: number) => {
    if (!list.length) return;
    void showAction(nodeId, Math.min(list.length - 1, Math.max(0, (shown ?? -1) + d)));
  };

  return (
    <div className="border-t border-border pt-3 text-[11px]">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-gray-500 uppercase tracking-wide text-[10px]">
          Actions{list.length ? ` (${list.length})` : ""}
        </span>
        <span className="ml-auto flex gap-1">
          <button className="px-1.5 rounded border border-border text-gray-400 hover:border-accent disabled:opacity-40"
                  disabled={!list.length || shown === 0} onClick={() => step(-1)} title="The action before">‹</button>
          <button className="px-1.5 rounded border border-border text-gray-400 hover:border-accent disabled:opacity-40"
                  disabled={!list.length || shown === list.length - 1} onClick={() => step(1)} title="The next action">›</button>
          {shown !== null && (
            <button className="px-1.5 rounded border border-border text-gray-400 hover:border-accent"
                    onClick={() => void showAction(nodeId, null)} title="Back to the node's result">✕</button>
          )}
        </span>
      </div>
      {actions === "loading" && <div className="text-gray-500">loading…</div>}
      {Array.isArray(actions) && !list.length && <div className="text-gray-500">No actions: it didn't need any.</div>}
      {list.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded border border-border">
          <table className="w-full tabular-nums">
            <thead className="sticky top-0 bg-panel text-gray-500 text-[10px]">
              <tr>
                <th className="text-left px-1 font-normal">#</th>
                <th className="text-left px-1 font-normal">step</th>
                <th className="text-left px-1 font-normal">what</th>
                <th className="text-right px-1 font-normal" title="The press load it needed (isothermal)">kN</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a, i) => (
                <tr key={i} onClick={() => void showAction(nodeId, i)}
                    title={a.cycle !== undefined ? `cycle ${a.cycle}` : undefined}
                    className={`cursor-pointer ${shown === i ? "bg-accent/25 text-gray-100" : "text-gray-300 hover:bg-surface"}`}>
                  <td className="px-1 text-gray-500">{i + 1}</td>
                  <td className="px-1 whitespace-nowrap">{a.label ?? a.kind}</td>
                  <td className="px-1 text-gray-400">{a.what}</td>
                  <td className="px-1 text-right text-gray-400">{a.load_kN !== undefined ? a.load_kN.toFixed(0) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-gray-600 mt-1">
        Click a step to see the part after it. The replay plays every step; exporting the path bakes them into plain
        steps.
      </div>
    </div>
  );
}
