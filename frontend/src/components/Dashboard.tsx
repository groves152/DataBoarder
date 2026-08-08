import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { useEffect, useRef, useState, useCallback } from "react";
import { useDataStore } from "@/stores/dataStore";
import { useLayoutStore, findFreePosition } from "@/stores/layoutStore";
import { MultiPanel } from "./MultiPanel";
import { ScalarPanel } from "./ScalarPanel";
import { HistogramPanel } from "./HistogramPanel";
import { ImagePanel } from "./ImagePanel";
import { MeshPanel } from "./MeshPanel";
import { AnimationPanel } from "./AnimationPanel";
import type { DataType, PanelLayout } from "@/types";

const ResponsiveGrid = WidthProvider(GridLayout);

const DEFAULT_SIZE: Record<DataType, { w: number; h: number }> = {
  scalar:          { w: 4, h: 6 },
  scalars:         { w: 4, h: 6 },
  histogram:       { w: 3, h: 5 },
  image:           { w: 3, h: 5 },
  images:          { w: 4, h: 5 },
  mesh:            { w: 5, h: 7 },
  animation_frame: { w: 4, h: 6 },
};

function inferType(entries: { type: DataType }[]): DataType {
  return entries[0]?.type ?? "scalar";
}

function SinglePanelContent({ panel }: { panel: PanelLayout }) {
  const { run, tag, type } = panel.sources[0];
  switch (type) {
    case "scalar":
    case "scalars":         return <ScalarPanel    run={run} tag={tag} />;
    case "histogram":       return <HistogramPanel  run={run} tag={tag} />;
    case "image":
    case "images":          return <ImagePanel      run={run} tag={tag} />;
    case "mesh":            return <MeshPanel       run={run} tag={tag} />;
    case "animation_frame": return <AnimationPanel  run={run} tag={tag} />;
  }
}

// ── Run tab bar ───────────────────────────────────────────────────────────────

/** Group runs by the prefix before the last "/" — flat runs have group = null. */
function groupRuns(runs: string[]): Map<string | null, { label: string; fullName: string }[]> {
  const groups = new Map<string | null, { label: string; fullName: string }[]>();
  for (const run of runs) {
    const slash = run.lastIndexOf("/");
    const group = slash > 0 ? run.slice(0, slash) : null;
    const label = slash > 0 ? run.slice(slash + 1) : run;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ label, fullName: run });
  }
  return groups;
}

function RunTabs({ onRefresh }: { onRefresh: () => void }) {
  const { runs, activeRun, setActiveRun } = useDataStore();
  const displayRuns = runs.length ? runs : ["default"];
  const groups = groupRuns(displayRuns);

  return (
    <div className="flex items-center gap-1 px-3 h-10 border-b border-border bg-panel shrink-0 overflow-x-auto">
      <span className="text-xs font-semibold text-gray-500 mr-2 uppercase tracking-wide shrink-0">
        Runs
      </span>

      {Array.from(groups.entries()).map(([group, members], gi) => (
        <span key={group ?? "__flat"} className="flex items-center gap-1 shrink-0">
          {/* Divider between groups */}
          {gi > 0 && <span className="text-gray-700 mx-1 select-none">|</span>}
          {/* Group label */}
          {group && (
            <span className="text-[10px] text-gray-600 font-medium mr-0.5 whitespace-nowrap select-none">
              {group}:
            </span>
          )}
          {/* Sub-run buttons */}
          {members.map(({ label, fullName }) => (
            <button
              key={fullName}
              onClick={() => setActiveRun(fullName)}
              className={`px-3 py-1 rounded text-xs transition-colors whitespace-nowrap
                ${fullName === activeRun
                  ? "bg-accent text-white"
                  : "text-gray-400 hover:text-white hover:bg-border"}`}>
              {label}
            </button>
          ))}
        </span>
      ))}

      <div className="flex-1" />
      <button onClick={onRefresh} title="Re-fetch all data for this run"
        className="shrink-0 px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-border transition-colors">
        ↺ Refresh
      </button>
    </div>
  );
}

// ── Tag sidebar ───────────────────────────────────────────────────────────────
function TagSidebar({ run }: { run: string }) {
  const entries   = useDataStore((s) => s.entries[run] ?? {});
  const enabled   = useDataStore((s) => s.enabledTags[run] ?? []);
  const toggleTag = useDataStore((s) => s.toggleTag);
  const panels    = useLayoutStore((s) => s.panels);

  const activeInPanel = new Set(
    panels.flatMap((p) => p.sources.filter((s) => s.run === run).map((s) => s.tag)),
  );
  const tags = Object.keys(entries);

  return (
    <aside className="w-52 shrink-0 bg-panel border-r border-border flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tags</p>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {tags.length === 0 && <p className="px-3 py-2 text-xs text-gray-600">No data yet</p>}
        {tags.map((tag) => {
          const on = enabled.includes(tag) || activeInPanel.has(tag);
          return (
            <button key={tag} onClick={() => toggleTag(run, tag)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs
                transition-colors ${on ? "text-white" : "text-gray-500 hover:text-gray-300"}`}>
              <span className={`w-3 h-3 rounded-sm border shrink-0 flex items-center justify-center
                ${on ? "bg-accent border-accent" : "border-gray-600"}`}>
                {on && <span className="text-white text-[8px] leading-none">✓</span>}
              </span>
              <span className="truncate">{tag}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export function Dashboard() {
  const activeRun   = useDataStore((s) => s.activeRun);
  const enabledTags = useDataStore((s) => s.enabledTags[activeRun] ?? []);
  const runEntries  = useDataStore((s) => s.entries[activeRun] ?? {});
  const toggleTag   = useDataStore((s) => s.toggleTag);
  const refreshRun  = useDataStore((s) => s.refreshRun);
  const { panels, addPanel, removeSource, updateGridLayout, merge } = useLayoutStore();

  // ── Ctrl+click merge selection ─────────────────────────────────────────────
  const [mergeCandidate, setMergeCandidate] = useState<string | null>(null);

  const handlePanelCtrlClick = useCallback((panelId: string) => {
    if (mergeCandidate === null) {
      setMergeCandidate(panelId);
    } else if (mergeCandidate === panelId) {
      setMergeCandidate(null); // deselect same panel
    } else {
      merge(mergeCandidate, panelId);
      setMergeCandidate(null);
    }
  }, [mergeCandidate, merge]);

  // ESC cancels pending merge selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setMergeCandidate(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Sync panels with enabledTags ───────────────────────────────────────────
  const prevEnabled = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevEnabled.current;
    for (const tag of enabledTags) {
      if (!prev.includes(tag)) {
        const id = `${activeRun}::${tag}::${Date.now()}`;
        const type = inferType(runEntries[tag] ?? []);
        const { w, h } = DEFAULT_SIZE[type] ?? { w: 4, h: 6 };
        const { x, y } = findFreePosition(panels, w, h);
        addPanel({ i: id, x, y, w, h, sources: [{ run: activeRun, tag, type }], mergeMode: "overlay" });
      }
    }
    for (const tag of prev) {
      if (!enabledTags.includes(tag)) {
        const toClean = panels.filter((p) => p.sources.some((s) => s.run === activeRun && s.tag === tag));
        for (const p of toClean) removeSource(p.i, tag, activeRun);
      }
    }
    prevEnabled.current = enabledTags;
  }, [enabledTags, activeRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const activePanels = panels.filter((p) => p.sources.some((s) => s.run === activeRun));

  return (
    <div className="flex flex-col h-full bg-surface text-white overflow-hidden">
      <RunTabs onRefresh={() => refreshRun(activeRun)} />

      {/* Merge hint banner */}
      {mergeCandidate !== null && (
        <div className="shrink-0 bg-accent/20 border-b border-accent/40 px-4 py-1.5 text-xs text-accent flex items-center gap-3">
          <span>⊕ Ctrl+click another panel to merge — or press <kbd className="px-1 py-0.5 rounded bg-accent/30 font-mono">Esc</kbd> to cancel</span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <TagSidebar run={activeRun} />

        <main className="flex-1 overflow-auto p-3">
          {activePanels.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm select-none">
              Click tags in the sidebar to add panels
            </div>
          ) : (
            <ResponsiveGrid
              layout={activePanels}
              cols={12}
              rowHeight={80}
              compactType={null}
              preventCollision={true}
              draggableHandle=".drag-handle"
              onDragStop={(layout) => updateGridLayout(layout)}
              onResizeStop={(layout) => {
                updateGridLayout(layout);
                window.dispatchEvent(new Event("resize"));
              }}
              resizeHandles={["se", "sw", "ne", "nw"]}
              margin={[8, 8]}
            >
              {activePanels.map((panel) => {
                const isCandidate = panel.i === mergeCandidate;
                const isMergeTarget = mergeCandidate !== null && panel.i !== mergeCandidate;
                return (
                  <div key={panel.i}
                    className={`flex flex-col bg-panel rounded border overflow-hidden transition-all
                      ${isCandidate
                        ? "border-accent shadow-[0_0_0_2px_#7c6af7]"
                        : isMergeTarget
                          ? "border-accent/50 hover:border-accent hover:shadow-[0_0_0_2px_#7c6af766] cursor-pointer"
                          : "border-border"}`}>

                    {/* Title bar */}
                    <div
                      className="drag-handle flex items-center gap-1 px-2 py-1
                        border-b border-border cursor-grab active:cursor-grabbing select-none shrink-0 min-w-0"
                      onClickCapture={(e) => {
                        if (e.ctrlKey || e.metaKey) {
                          e.stopPropagation();
                          handlePanelCtrlClick(panel.i);
                        }
                      }}
                    >
                      {panel.sources.length > 1 && (
                        <span className="text-[9px] text-accent shrink-0 font-bold">⊕</span>
                      )}
                      {isCandidate && (
                        <span className="text-[9px] text-accent shrink-0">●</span>
                      )}
                      <span className="text-xs text-gray-400 truncate flex-1 min-w-0" title={panel.sources.map((s) => s.tag).join(" + ")}>
                        {panel.sources.map((s) => s.tag).join(" + ")}
                      </span>
                      {/* Ctrl+click hint icon */}
                      <span
                        title="Ctrl+click to select for merge"
                        className="text-[9px] text-gray-600 hover:text-gray-400 shrink-0 select-none"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey) return;
                          handlePanelCtrlClick(panel.i);
                        }}
                      >⊕</span>
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          if (isCandidate) setMergeCandidate(null);
                          for (const src of panel.sources) toggleTag(src.run, src.tag);
                        }}
                        className="text-gray-600 hover:text-red-400 text-xs shrink-0 ml-1">
                        ✕
                      </button>
                    </div>

                    {/* Panel body */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                      {panel.sources.length === 1
                        ? <SinglePanelContent panel={panel} />
                        : <MultiPanel panelId={panel.i} sources={panel.sources} mergeMode={panel.mergeMode} />
                      }
                    </div>
                  </div>
                );
              })}
            </ResponsiveGrid>
          )}
        </main>
      </div>
    </div>
  );
}
