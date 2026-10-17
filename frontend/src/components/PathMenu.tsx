import { useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { GenerateDialog } from "./GenerateDialog";
import { TransformDialog } from "./TransformDialog";
import { PasteJsonDialog } from "./PasteJsonDialog";
import { RawJsonDialog } from "./RawJsonDialog";
import { isPathJson, isGraphJson } from "@/utils/pathJson";
import { useCurrentProgram } from "@/hooks/useCurrentProgram";
import { programLabel } from "@/utils/programs";
import { openSetupSheet } from "@/utils/setupSheet";
import type { GeneratorSchema } from "@/types/pipeline";

// Own menu structure (separate from GraphPanel's "+ node kind" toolbar):
// import/export as JSON, and generate a path deterministically from a
// registered generator (e.g. "cogging_cyl_to_rect"). Two JSON shapes round
// trip here: a "path" (root + linear step chain -- generate/cross-source
// policies live here) and a raw "graph" (arbitrary-topology nodes+edges,
// the same shape `cook()` already consumes -- whole-graph or
// multi-selected-subset persistence). Import accepts either shape.
// Generators grouped by their registered category (uncategorized last), in
// the order the categories first appear.
function generatorGroups(schemas: GeneratorSchema[]): [string, GeneratorSchema[]][] {
  const groups = new Map<string, GeneratorSchema[]>();
  for (const g of schemas) {
    const title = g.category ?? "Generate";
    groups.set(title, [...(groups.get(title) ?? []), g]);
  }
  return [...groups.entries()].sort((a, b) => Number(a[0] === "Generate") - Number(b[0] === "Generate"));
}

// A row that opens a flyout to its right on hover (or click, for touch), like a
// desktop application's menu bar; the flyout sits flush against the row so
// the pointer can cross into it.
function Submenu({ id, label, openId, setOpenId, children }: {
  id: string; label: string; openId: string | null; setOpenId: (id: string | null) => void; children: React.ReactNode;
}) {
  const isOpen = openId === id;
  return (
    <div className="relative" onMouseEnter={() => setOpenId(id)}>
      <button
        onClick={() => setOpenId(isOpen ? null : id)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
          isOpen ? "bg-surface text-gray-100" : "text-gray-300 hover:bg-surface hover:text-gray-100"
        }`}
      >
        <span className="flex-1 truncate">{label}</span>
        <span className="text-gray-500">▸</span>
      </button>
      {isOpen && (
        <div className="absolute left-full top-0 -mt-1 w-64 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-panel shadow-xl py-1">
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, disabled, title, children }: {
  onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface hover:text-gray-100 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-300"
    >
      {children}
    </button>
  );
}

export function PathMenu() {
  const {
    generatorSchemas, fetchGeneratorSchemas, transformSchemas, fetchTransformSchemas, loadPath, exportPath, importGraph, exportGraph, tag, nodes,
    diagnostics, goalName,
  } = usePipelineStore();
  const { programs, current } = useCurrentProgram();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<string | null>(null); // the open flyout (desktop-menu style)
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeGenerator, setActiveGenerator] = useState<string | null>(null);
  const [activeTransform, setActiveTransform] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [rawJsonPreview, setRawJsonPreview] = useState<{ data: unknown; filename: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedCount = nodes.filter((n) => n.selected).length;

  useEffect(() => {
    fetchGeneratorSchemas();
    fetchTransformSchemas();
  }, [fetchGeneratorSchemas, fetchTransformSchemas]);

  useEffect(() => {
    if (!open) {
      setSub(null);
      return;
    }
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

  function handlePasteClick() {
    setPasteOpen(true);
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
    setRawJsonPreview({ data: path, filename: `${tag || "path"}.json` });
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
    setRawJsonPreview({ data: graph, filename: `${tag || "graph"}${onlySelected ? "_selection" : ""}.json` });
    setOpen(false);
  }

  const activeSchema = generatorSchemas.find((g) => g.name === activeGenerator);
  const activeTransformSchema = transformSchemas.find((t) => t.name === activeTransform);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-2 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors"
      >
        Path ▾
      </button>
      <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFileChange} />

      {open && (
        <div className="absolute z-40 mt-1 w-48 rounded-md border border-border bg-panel shadow-xl py-1 text-xs">
          <Submenu id="import" label="Import" openId={sub} setOpenId={setSub}>
            <MenuItem onClick={handleImportClick}>From file (path or graph JSON)…</MenuItem>
            <MenuItem onClick={handlePasteClick}>Paste JSON…</MenuItem>
          </Submenu>
          <Submenu id="export" label="Export" openId={sub} setOpenId={setSub}>
            <MenuItem onClick={handleExportPathClick} title="Only works if the graph is a single linear chain, no branches">
              As path (JSON)
            </MenuItem>
            <MenuItem onClick={() => handleExportGraphClick(false)}>Whole graph (JSON)</MenuItem>
            <MenuItem onClick={() => handleExportGraphClick(true)} disabled={selectedCount === 0}>
              Selection (JSON){selectedCount > 0 ? ` — ${selectedCount} node${selectedCount === 1 ? "" : "s"}` : ""}
            </MenuItem>
            <MenuItem disabled={!current} title="A printable sheet of the program in view, for the press operator (and its CSV)"
                      onClick={() => {
                        if (!current) return;
                        const byId = new Map(nodes.map((n) => [n.id, n]));
                        const name = programLabel(current, programs.indexOf(current), (id) => {
                          const l = byId.get(id)?.data.params.label;
                          return typeof l === "string" && l ? l : undefined;
                        });
                        if (!openSetupSheet(name, goalName, current.nodeIds, byId, diagnostics)) {
                          setExportError("The browser blocked the setup sheet's window: allow pop-ups for this page.");
                        }
                        setOpen(false);
                      }}>
              Setup sheet (program in view)…
            </MenuItem>
          </Submenu>
          {transformSchemas.length > 0 && (
            <Submenu id="transform" label="Transform this path" openId={sub} setOpenId={setSub}>
              {transformSchemas.map((t) => (
                <MenuItem key={t.name} onClick={() => { setActiveTransform(t.name); setOpen(false); }}>
                  {t.name === "fill_heats" ? "🔥 Fill heat actions…" : `${t.name}…`}
                </MenuItem>
              ))}
            </Submenu>
          )}
          {generatorSchemas.length > 0 && <div className="border-t border-border my-1" />}
          {generatorGroups(generatorSchemas).map(([title, items]) => (
            <Submenu key={title} id={`generate:${title}`} label={title} openId={sub} setOpenId={setSub}>
              {items.map((g) => (
                <MenuItem key={g.name} title={g.name} onClick={() => { setActiveGenerator(g.name); setOpen(false); }}>
                  {g.label ?? g.name}…
                </MenuItem>
              ))}
            </Submenu>
          ))}
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

      {activeTransformSchema && (
        <TransformDialog schema={activeTransformSchema} onClose={() => setActiveTransform(null)} />
      )}
      {activeSchema && (
        <GenerateDialog schema={activeSchema} onClose={() => setActiveGenerator(null)} />
      )}

      {pasteOpen && <PasteJsonDialog onClose={() => setPasteOpen(false)} />}

      {rawJsonPreview && (
        <RawJsonDialog
          data={rawJsonPreview.data}
          filename={rawJsonPreview.filename}
          onClose={() => setRawJsonPreview(null)}
        />
      )}
    </div>
  );
}
