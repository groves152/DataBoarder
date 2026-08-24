import { useTagData } from "@/hooks/useTagData";
import { MeshGeometry } from "./MeshPanel";
import type { MeshData } from "@/types";

// Distinct from the billet's purple and PressPreview's orange/red, so a
// goal mesh reads as a third, separate thing at a glance.
const GOAL_COLOR = "#4ade80";

interface Props { run: string; tag: string; opacity: number }

// Renders a target/goal mesh (see ui_nodes/targets.py) as a translucent
// overlay. Reuses MeshPanel's own exported MeshGeometry rather than
// hand-building three.js primitives (unlike PressPreview, which draws an
// analytic die shape) -- a goal is a real triangle mesh already in the
// same coordinate convention/scale as the billet (see targets.py's
// docstring), so no special-cased geometry construction is needed here.
export function GoalOverlay({ run, tag, opacity }: Props) {
  const entries = useTagData(run, tag);
  const mesh = entries.find((e) => e.type === "mesh")?.data as MeshData | undefined;
  if (!mesh) return null;
  return <MeshGeometry data={mesh} color={GOAL_COLOR} opacity={opacity} transparent />;
}
