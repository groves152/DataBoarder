import { useMemo } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { programsOf, type Program } from "@/utils/programs";

// The program the viewport's replay and the sequence stats follow: the one
// holding the selected node, else the one dived into, else the first.
export function useCurrentProgram(): { programs: Program[]; current: Program | undefined } {
  const nodes = usePipelineStore((s) => s.nodes);
  const edges = usePipelineStore((s) => s.edges);
  const selectedNodeId = usePipelineStore((s) => s.selectedNodeId);
  const focusedProgram = usePipelineStore((s) => s.focusedProgram);
  const programs = useMemo(() => programsOf(nodes, edges), [nodes, edges]);
  const current = useMemo(
    () => (selectedNodeId && programs.find((p) => p.nodeIds.includes(selectedNodeId)))
      || programs.find((p) => p.root === focusedProgram) || programs[0],
    [programs, selectedNodeId, focusedProgram],
  );
  return { programs, current };
}
