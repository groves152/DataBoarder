// Live, uncooked preview of where a strike node's press would contact the
// billet -- purely a geometric proxy from the node's CURRENT slider values
// (not the cooked mesh), so it updates instantly while dragging, before
// any cook has even fired. Positioning matches slab_state_to_mesh's own
// convention (billet axis = world X, cross-section in world Y-Z, Y =
// r*cos(theta), Z = r*sin(theta)) -- a <group rotation={[phi,0,0]}> maps a
// pre-rotation local point (z, rho/2, 0) to exactly (z, rho/2*cos(phi),
// rho/2*sin(phi)), the same formula the mesh conversion uses.

import { useTagData } from "@/hooks/useTagData";
import { MeshGeometry } from "./MeshPanel";
import { TOOLS_RUN, TOOLS_TAG_PREFIX } from "@/stores/pipelineStore";
import type { MeshData } from "@/types";

const PREVIEW_COLOR = "#f97316"; // orange -- distinct from the mesh (purple) and UI accent
// When the last cook reported this strike's requested gap was capped by
// the real press's physical limit, the preview snaps to the ACHIEVED gap
// (not the impossible requested one) and switches to red, so it's visibly
// a "this is what will actually happen" indicator, not "here's your slider".
const CAPPED_COLOR = "#f87171";
const DIE_THICKNESS = 5;

export interface ToolDims {
  shape: "box" | "round" | "mesh";
  half_width?: number;
  half_tangential?: number;
  nose_radius?: number;
}

interface Props {
  z: number;
  phi: number;
  rho: number;
  toolDims: ToolDims;
  // Which tool is selected -- only needed to fetch the real mesh when
  // toolDims.shape === "mesh" (box/round shapes are drawn as primitives,
  // no name lookup needed).
  toolName?: string;
  capped?: boolean;
}

function DieFace({
  sign, z, rho, toolDims, color, meshData,
}: { sign: 1 | -1; z: number; rho: number; toolDims: ToolDims; color: string; meshData?: MeshData }) {
  const offset = rho / 2;
  const halfTangential = toolDims.half_tangential ?? 15;

  if (toolDims.shape === "mesh") {
    if (!meshData) return null;
    // The die mesh's own local frame is (x=axial, y=depth-from-contact-
    // face increasing INTO the die body, z=tangential), y=0 at the
    // contact tip (see slab/tool.py's _reoriented_die_mesh). For the
    // sign=-1 face, the body needs to extend to MORE NEGATIVE y beyond
    // -offset -- a mirror along Y (scale=[1,-1,1]), not a rotation, so
    // the tip stays exactly AT the contact plane for both faces. Real
    // mesh geometry (not a box), so this directly proves which tool is
    // actually selected -- no separate mesh needed for MeshGeometry's
    // side=DoubleSide to still render reasonably despite the flipped
    // winding on the mirrored instance.
    return (
      <group position={[z, sign * offset, 0]} scale={[1, sign, 1]}>
        <MeshGeometry data={meshData} color={color} opacity={0.35} transparent />
      </group>
    );
  }

  if (toolDims.shape === "round") {
    const radius = toolDims.nose_radius ?? 8;
    return (
      <mesh position={[z, sign * offset, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius, radius, 2 * halfTangential, 20]} />
        <meshStandardMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      </mesh>
    );
  }

  const halfWidth = toolDims.half_width ?? 7;
  return (
    <mesh position={[z, sign * offset, 0]}>
      <boxGeometry args={[2 * halfWidth, DIE_THICKNESS, 2 * halfTangential]} />
      <meshStandardMaterial color={color} transparent opacity={0.35} depthWrite={false} />
    </mesh>
  );
}

export function PressPreview({ z, phi, rho, toolDims, toolName, capped }: Props) {
  const color = capped ? CAPPED_COLOR : PREVIEW_COLOR;
  // Always called (rules-of-hooks) -- tag is "" when not needed, a single
  // harmless empty fetch, not a per-shape conditional hook call.
  const meshTag = toolDims.shape === "mesh" && toolName ? `${TOOLS_TAG_PREFIX}${toolName}` : "";
  const meshEntries = useTagData(TOOLS_RUN, meshTag);
  const meshData = meshEntries.find((e) => e.type === "mesh")?.data as MeshData | undefined;

  return (
    <group rotation={[phi, 0, 0]}>
      <DieFace sign={1} z={z} rho={rho} toolDims={toolDims} color={color} meshData={meshData} />
      <DieFace sign={-1} z={z} rho={rho} toolDims={toolDims} color={color} meshData={meshData} />
      {/* small marker at the strike axis itself, for orientation */}
      <mesh position={[z, 0, 0]}>
        <sphereGeometry args={[1.2, 12, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}
