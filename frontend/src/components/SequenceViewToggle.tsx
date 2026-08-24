import { useMemo } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { topologicalOrder } from "@/utils/graphOrder";

// Renamed from PlaySequenceButton -- it was previously a circular ▶/⏸
// button, which visually duplicated MeshPanel's OWN ▶/⏸ transport control
// right below it (reported directly: "duplicate play button... do we need
// both?"). They're not actually redundant -- this one just picks WHICH
// tag the mesh panel points to ("{tag}/__sequence__" vs. the selected
// node's own tag), while MeshPanel's controls do the actual play/pause/
// scrub/FPS -- but a ▶/⏸ glyph implied it also transported playback
// itself. A plain checkbox, matching "Press preview"/"Trend panel"'s
// styling, reads correctly as the view-mode toggle it actually is.
export function SequenceViewToggle() {
  const nodes = usePipelineStore((s) => s.nodes);
  const edges = usePipelineStore((s) => s.edges);
  const viewSequence = usePipelineStore((s) => s.viewSequence);
  const setViewSequence = usePipelineStore((s) => s.setViewSequence);

  const order = useMemo(() => topologicalOrder(nodes, edges), [nodes, edges]);
  const disabled = !order || order.length === 0;

  return (
    <label
      className={`flex items-center gap-1.5 cursor-pointer select-none text-gray-400 ${disabled ? "opacity-40 pointer-events-none" : ""}`}
      title={order ? "Show the whole cooked sequence -- scrub/play it with the mesh panel's own controls" : "Can't view sequence — graph has a cycle"}
    >
      <input
        type="checkbox"
        checked={viewSequence}
        disabled={disabled}
        onChange={(e) => setViewSequence(e.target.checked)}
        className="accent-accent"
      />
      <span>Sequence view</span>
    </label>
  );
}
