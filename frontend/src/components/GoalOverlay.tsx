import { useTagData } from "@/hooks/useTagData";
import { MeshGeometry } from "./MeshPanel";
import type { MeshData } from "@/types";

// Distinct from the billet's purple and PressPreview's orange/red, so a
// goal mesh reads as a third, separate thing at a glance.
export const GOAL_COLOR = "#4ade80";
// A plan's subgoal (the shape one leg should make): amber, beside the goal's green.
export const SUBGOAL_COLOR = "#fbbf24";

interface Props { run: string; tag: string; opacity: number; color?: string }

// Renders a target/goal mesh (see ui_nodes/targets.py) as a translucent
// overlay. Reuses MeshPanel's own exported MeshGeometry rather than
// hand-building three.js primitives (unlike PressPreview, which draws an
// analytic die shape) -- a goal is a real triangle mesh already in the
// same coordinate convention/scale as the billet (see targets.py's
// docstring), so no special-cased geometry construction is needed here.
// Also draws any other reference mesh by tag, in its own `color` (e.g. a
// pinned program's final part, to compare against).
export function GoalOverlay({ run, tag, opacity, color = GOAL_COLOR }: Props) {
  const entries = useTagData(run, tag);
  const mesh = entries.find((e) => e.type === "mesh")?.data as MeshData | undefined;
  if (!mesh) return null;
  return <MeshGeometry data={mesh} color={color} opacity={opacity} transparent />;
}
