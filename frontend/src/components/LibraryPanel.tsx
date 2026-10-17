import { useEffect, useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { entryId, useLibraryStore, type LibraryEntry } from "@/stores/libraryStore";
import { useCurrentProgram } from "@/hooks/useCurrentProgram";
import { programLabel } from "@/utils/programs";

// The side panel's Library tab: save the graph (or the program in view) under
// a name, and open saved ones -- replacing the graph, or beside it to compare.
// The session itself is autosaved separately (pipelineStore's history section).
const btn = "px-2 py-0.5 rounded border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors disabled:opacity-40";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function LibraryPanel() {
  const { entries, available, refresh, save, open, remove } = useLibraryStore();
  const nodes = usePipelineStore((s) => s.nodes);
  const snapshotGraph = usePipelineStore((s) => s.snapshotGraph);
  const { programs, current } = useCurrentProgram();
  const [name, setName] = useState("");
  useEffect(() => void refresh(), [refresh]);

  const currentName = current ? programLabel(current, programs.indexOf(current), (id) => {
    const l = nodes.find((n) => n.id === id)?.data.params.label;
    return typeof l === "string" && l ? l : undefined;
  }) : "";
  const saveAs = async (ids?: string[]) => {
    const n = name.trim() || currentName || "untitled";
    if (entries.some((e) => e.id === entryId(n)) && !window.confirm(`Replace the saved "${n}"?`)) return;
    if (await save(n, snapshotGraph(ids))) setName("");
  };

  if (!available) {
    return <div className="p-3 text-xs text-gray-500">This server has no library (start it with a library directory).</div>;
  }
  return (
    <div className="h-full flex flex-col overflow-y-auto text-xs text-gray-300">
      <div className="p-3 border-b border-border flex flex-col gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={currentName || "name"}
               onKeyDown={(e) => { if (e.key === "Enter") void saveAs(); }}
               className="bg-surface border border-border rounded px-2 py-1 text-gray-200" />
        <div className="flex gap-1.5">
          <button className={btn} disabled={nodes.length === 0} onClick={() => void saveAs()}
                  title="Save every program in the graph">Save graph</button>
          <button className={btn} disabled={!current || programs.length < 2} onClick={() => void saveAs(current?.nodeIds)}
                  title="Save only the program in view (the selected node's)">Save this program</button>
        </div>
      </div>
      {entries.length === 0 && <div className="p-3 text-gray-500">Nothing saved yet.</div>}
      {entries.map((e: LibraryEntry) => (
        <div key={e.id} className="px-3 py-2 border-b border-border flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-gray-100 truncate" title={e.name}>{e.name}</div>
            <div className="text-[10px] text-gray-500 tabular-nums">
              {when(e.saved_at)}
              {e.summary.programs ? ` · ${e.summary.programs} program${e.summary.programs === 1 ? "" : "s"}` : ""}
              {e.summary.nodes ? ` · ${e.summary.nodes} nodes` : ""}
              {e.summary.goal ? ` · goal ${e.summary.goal}` : ""}
            </div>
          </div>
          <button className={btn} onClick={() => void open(e, "replace")} title="Replace the graph with it">Open</button>
          <button className={btn} onClick={() => void open(e, "add")} disabled={nodes.length === 0}
                  title="Add it beside the graph's programs, to compare">Add</button>
          <button className="text-gray-500 hover:text-red-400 px-1" aria-label={`Delete ${e.name}`}
                  onClick={() => { if (window.confirm(`Delete "${e.name}" from the library?`)) void remove(e); }}>✕</button>
        </div>
      ))}
    </div>
  );
}
