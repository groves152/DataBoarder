import { useState } from "react";
import { SequenceTrendPanel } from "./SequenceTrendPanel";
import { OptimizePanel } from "./OptimizePanel";
import { SearchPanel } from "./SearchPanel";

// The pipeline view's right-hand panel: program search (MAP-Elites over hit
// sequences), the gradient optimizer, and per-step statistics of the current
// sequence. "Expand" widens the panel over the viewport (the caller owns the
// layout), e.g. to watch a search's archive fill up.

type Tab = "search" | "optimize" | "stats";

interface Props {
  playbackStep: number | null;
  selectedNodeId: string | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
}

export function SidePanel({ playbackStep, selectedNodeId, expanded, onToggleExpand, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("stats");
  const tabClass = (t: Tab) =>
    `px-2 py-1 text-[10px] uppercase tracking-wide font-semibold border-b-2 transition-colors ${
      tab === t ? "border-accent text-gray-100" : "border-transparent text-gray-500 hover:text-gray-300"
    }`;

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="flex items-center gap-1 px-1.5 border-b border-border shrink-0">
        <button className={tabClass("search")} onClick={() => setTab("search")}>Sequence search</button>
        <button className={tabClass("optimize")} onClick={() => setTab("optimize")}>Optimize</button>
        <button className={tabClass("stats")} onClick={() => setTab("stats")}>Sequence stats</button>
        <div className="ml-auto flex items-center gap-1 text-gray-400">
          <button
            onClick={onToggleExpand}
            title={expanded ? "Shrink back" : "Expand over the viewport"}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-surface hover:text-gray-100 transition-colors"
          >
            {expanded ? "⇥" : "⇤"}
          </button>
          <button
            onClick={onClose}
            title="Hide this panel"
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-surface hover:text-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {tab === "search" && <SearchPanel />}
        {tab === "optimize" && <OptimizePanel />}
        {tab === "stats" && <SequenceTrendPanel playbackStep={playbackStep} selectedNodeId={selectedNodeId} />}
      </div>
    </div>
  );
}
