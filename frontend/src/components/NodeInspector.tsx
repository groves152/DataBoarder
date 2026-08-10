import { usePipelineStore } from "@/stores/pipelineStore";
import { ParamControl } from "./ParamControl";

export function NodeInspector() {
  const { nodes, nodeKinds, selectedNodeId, updateNodeParam, cooking, cookError, diagnostics } = usePipelineStore();
  const node = nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-500 p-4 text-center">
        Select a node to edit its parameters.
      </div>
    );
  }

  const schema = nodeKinds.find((k) => k.kind === node.data.kind);
  const nodeDiag = diagnostics[node.id];
  const capped = Boolean(nodeDiag?.capped);

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="px-3 py-2 border-b border-border">
        <div className="text-xs text-gray-500">{node.data.kind}</div>
        <div className="text-sm text-gray-200 font-medium">{node.id}</div>
        <div className={`text-[10px] mt-1 ${node.data.cooked ? "text-green-400" : "text-gray-500"}`}>
          {node.data.cooked ? "cooked" : "stale — will cook shortly"}
        </div>
      </div>

      {capped && (
        <div className="px-3 py-2 border-b border-border bg-amber-950/40 text-[11px] text-amber-300">
          ⚠ Limited by physical press capacity — requested{" "}
          {typeof nodeDiag?.commanded_rho === "number" ? nodeDiag.commanded_rho.toFixed(1) : "?"}mm, achieved{" "}
          {typeof nodeDiag?.achieved_rho === "number" ? nodeDiag.achieved_rho.toFixed(1) : "?"}mm this pass. Chain
          another strike here for a second pass, or turn off "Physical press limit" below.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-4">
        {schema && Object.entries(schema.params).map(([name, spec]) => (
          <ParamControl
            key={name}
            name={name}
            spec={spec}
            value={node.data.params[name] ?? spec.default}
            onChange={(v) => updateNodeParam(node.id, name, v)}
          />
        ))}
        {!schema && (
          <div className="text-xs text-gray-500">Unknown node kind — no schema loaded.</div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-border text-[11px]">
        {cooking && <div className="text-accent">cooking…</div>}
        {cookError && <div className="text-red-400 break-words">{cookError}</div>}
      </div>
    </div>
  );
}
