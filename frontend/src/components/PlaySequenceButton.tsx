import { useEffect, useMemo, useRef, useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { topologicalOrder } from "@/utils/graphOrder";

const DEFAULT_INTERVAL_MS = 900;

// Plays through the CURRENT graph's nodes in topological order, ONCE --
// selecting each node in turn and letting the existing "viewport shows
// whichever node is selected" mechanism (PipelineView) do the rendering.
// This replaced scrubbing a single node's own cook-history "frames": each
// node's mesh tag now holds only its current cook (server.py's cook_pipeline
// pushes with replace=True), so there's no per-node history left to play
// through -- the strike sequence lives in the graph's topology, walked
// here, not in accumulated buffer steps.
export function PlaySequenceButton() {
  const nodes = usePipelineStore((s) => s.nodes);
  const edges = usePipelineStore((s) => s.edges);
  const selectNode = usePipelineStore((s) => s.selectNode);

  const order = useMemo(() => topologicalOrder(nodes, edges), [nodes, edges]);
  const orderKey = order?.join(",") ?? "";

  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The sequence itself changed (edit/add/delete/rewire) -- don't keep
  // playing against a now-stale order.
  useEffect(() => {
    setPlaying(false);
    setIndex(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  useEffect(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!playing || !order || order.length === 0) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => {
        const next = i + 1;
        if (next >= order.length) {
          setPlaying(false);
          return i;
        }
        return next;
      });
    }, DEFAULT_INTERVAL_MS);
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing, order]);

  useEffect(() => {
    if (order && index >= 0 && index < order.length) selectNode(order[index]);
  }, [index, order, selectNode]);

  function togglePlay() {
    if (!order || order.length === 0) return;
    if (!playing) {
      setIndex((i) => (i < 0 || i >= order.length - 1 ? 0 : i));
    }
    setPlaying((p) => !p);
  }

  const disabled = !order || order.length === 0;

  return (
    <div className="flex items-center gap-1.5 ml-2">
      <button
        onClick={togglePlay}
        disabled={disabled}
        title={
          order
            ? "Play through this graph's nodes in order, once"
            : "Can't play — graph has a cycle"
        }
        className="w-6 h-6 flex items-center justify-center rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-white disabled:opacity-40 disabled:hover:text-gray-300 transition-colors"
      >
        {playing ? "⏸" : "▶"}
      </button>
      {order && order.length > 0 && (
        <span className="text-[11px] text-gray-500 tabular-nums">
          {index >= 0 ? index + 1 : 0}/{order.length}
        </span>
      )}
    </div>
  );
}
