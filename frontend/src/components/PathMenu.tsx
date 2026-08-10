import { useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import type { PathJson, GraphJson } from "@/types/pipeline";
import { GenerateDialog } from "./GenerateDialog";

function isPathJson(data: unknown): data is PathJson {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.root === "object" && d.root !== null &&
    typeof (d.root as Record<string, unknown>).kind === "string" &&
    Array.isArray(d.steps)
  );
}

function isGraphJson(data: unknown): data is GraphJson {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.nodes) && Array.isArray(d.edges);
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Own menu structure (separate from GraphPanel's "+ node kind" toolbar):
// import/export as JSON, and generate a path deterministically from a
// registered generator (e.g. "cogging_cyl_to_rect"). Two JSON shapes round
// trip here: a "path" (root + linear step chain -- generate/cross-source
// policies live here) and a raw "graph" (arbitrary-topology nodes+edges,
// the same shape `cook()` already consumes -- whole-graph or
// multi-selected-subset persistence). Import accepts either shape.
export function PathMenu() {
  const {
    generatorSchemas, fetchGeneratorSchemas, loadPath, exportPath, importGraph, exportGraph, tag, nodes,
  } = usePipelineStore();
  const [open, setOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeGenerator, setActiveGenerator] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedCount = nodes.filter((n) => n.selected).length;

  useEffect(() => {
    fetchGeneratorSchemas();
  }, [fetchGeneratorSchemas]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function handleImportClick() {
    fileInputRef.current?.click();
    setOpen(false);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file later
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (isPathJson(data)) {
        loadPath(data);
      } else if (isGraphJson(data)) {
        importGraph(data);
      } else {
        window.alert(
          "Not a recognized JSON shape — expected either a path ({root, steps}) or a graph ({nodes, edges}).",
        );
      }
    } catch (err) {
      window.alert(`Failed to import: ${String(err)}`);
    }
  }

  function handleExportPathClick() {
    const path = exportPath();
    if (!path) {
      setExportError("Current graph isn't a simple linear chain (no branches/merges) — can't export as a path.");
      setOpen(false);
      return;
    }
    setExportError(null);
    downloadJson(path, `${tag || "path"}.json`);
    setOpen(false);
  }

  function handleExportGraphClick(onlySelected: boolean) {
    const graph = exportGraph(onlySelected);
    if (!graph) {
      setExportError(onlySelected ? "No nodes selected." : "Graph is empty.");
      setOpen(false);
      return;
    }
    setExportError(null);
    downloadJson(graph, `${tag || "graph"}${onlySelected ? "_selection" : ""}.json`);
    setOpen(false);
  }

  const activeSchema = generatorSchemas.find((g) => g.name === activeGenerator);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-2 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-white transition-colors"
      >
        Path ▾
      </button>
      <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFileChange} />

      {open && (
        <div className="absolute z-40 mt-1 w-64 rounded-md border border-border bg-panel shadow-xl py-1 text-xs">
          <button
            onClick={handleImportClick}
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface hover:text-white"
          >
            Import (path or graph JSON)…
          </button>
          <div className="border-t border-border my-1" />
          <button
            onClick={handleExportPathClick}
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface hover:text-white"
            title="Only works if the graph is a single linear chain, no branches"
          >
            Export as path (JSON)
          </button>
          <button
            onClick={() => handleExportGraphClick(false)}
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface hover:text-white"
          >
            Export whole graph (JSON)
          </button>
          <button
            onClick={() => handleExportGraphClick(true)}
            disabled={selectedCount === 0}
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-300"
          >
            Export selection (JSON){selectedCount > 0 ? ` — ${selectedCount} node${selectedCount === 1 ? "" : "s"}` : ""}
          </button>
          {generatorSchemas.length > 0 && (
            <>
              <div className="border-t border-border my-1" />
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">Generate</div>
              {generatorSchemas.map((g) => (
                <button
                  key={g.name}
                  onClick={() => {
                    setActiveGenerator(g.name);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface hover:text-white"
                >
                  {g.name}…
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {exportError && (
        <div className="absolute z-40 mt-1 w-64 rounded-md border border-red-800 bg-red-950/80 px-3 py-2 text-[11px] text-red-300">
          {exportError}
          <button onClick={() => setExportError(null)} className="block mt-1 text-red-400 underline">
            dismiss
          </button>
        </div>
      )}

      {activeSchema && (
        <GenerateDialog schema={activeSchema} onClose={() => setActiveGenerator(null)} />
      )}
    </div>
  );
}
