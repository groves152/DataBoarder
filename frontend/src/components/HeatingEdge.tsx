import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from "@xyflow/react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { CHROME, seriesColor, useResolvedTheme } from "@/theme";

// An edge standing in for a run of folded "thermal" steps (heating, dwell)
// between two forging steps, when the graph isn't expanding heating actions.
// The flame badge shows how long they take; clicking it selects the first
// folded step, so its params open in the inspector and its mesh (with the
// coil) in the viewport.
export type HeatingEdgeData = { folded: string[]; heats: boolean };

export function HeatingEdge(props: EdgeProps<Edge<HeatingEdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const folded = data?.folded ?? [];
  const selectNode = usePipelineStore((s) => s.selectNode);
  const selectedNodeId = usePipelineStore((s) => s.selectedNodeId);
  const seconds = usePipelineStore((s) =>
    folded.reduce((acc, nid) => {
      const d = s.diagnostics[nid];
      return acc + Number(d?.transfer_s ?? 0) + Number(d?.duration_s ?? 0);
    }, 0),
  );
  const labels = usePipelineStore((s) =>
    folded.map((nid) => {
      const n = s.nodes.find((x) => x.id === nid);
      const label = n?.data.params.label;
      return typeof label === "string" && label ? label : n?.data.kind ?? nid;
    }),
  );
  const active = selectedNodeId !== null && folded.includes(selectedNodeId);
  const theme = useResolvedTheme();
  const heatColor = seriesColor(1, theme);  // the palette's orange
  const icon = data?.heats ? "🔥" : "⏱";

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd}
                style={{ stroke: data?.heats ? heatColor : CHROME[theme].muted, strokeDasharray: "5 4", strokeWidth: 1.5 }} />
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan absolute text-[10px] px-1.5 py-0.5 rounded-full border tabular-nums transition-colors bg-panel text-gray-200"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all",
            borderColor: heatColor, boxShadow: active ? `0 0 0 2px ${heatColor}` : undefined,
          }}
          title={`${labels.join(" → ")}\n${seconds.toFixed(0)} s — click to inspect (or check "Expand heating actions")`}
          onClick={(e) => {
            e.stopPropagation();
            selectNode(folded[0] ?? null);
          }}
        >
          {icon} {folded.length > 1 ? `${folded.length}× ` : ""}{seconds > 0 ? `${seconds.toFixed(0)} s` : ""}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
