import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useMemo, useState, useEffect, useRef, useCallback, useId, type ReactNode, type MutableRefObject } from "react";
import * as THREE from "three";
import { useTagData } from "@/hooks/useTagData";
import type { MeshData, MeshTool } from "@/types";
import { colormap, colormapCss, colormapKind, type ColormapKind } from "@/utils/colormap";
import { CHROME, useResolvedTheme, type ResolvedTheme } from "@/theme";

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

type ControlsLike = {
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
};

interface Props {
  run: string;
  tag: string;
  overlay?: ReactNode;
  // One-way "here's what step I'm currently showing" callback -- fired
  // whenever the displayed frame changes (scrub, play, or auto-advance).
  // MeshPanel stays the sole owner of playback state (no controlled-mode
  // props, so every OTHER existing usage of this component is completely
  // unaffected); a consumer that wants to sync its OWN display to
  // whatever MeshPanel is currently showing (e.g. a synced action/reward
  // trend chart) just observes this instead.
  onFrameChange?: (step: number) => void;
  // Overrides the PRIMARY mesh's opacity in single-frame mode (default
  // fully opaque). Cosmetic-only, sourced from a node's own "opacity"
  // param when it has one (currently just slab_stock) -- lets the caller
  // see through the billet without touching the simulation. Doesn't
  // affect overlay-all (ghosted multi-frame) mode, which already computes
  // its own per-frame opacity gradient for that view.
  meshOpacity?: number;
  // Persists camera position/orbit-target ACROSS remounts (e.g. switching
  // which node's tag this panel points at) via a ref the CALLER owns --
  // MeshPanel itself remounts on every tag change (a fresh <Canvas>, fresh
  // three.js camera/controls each time), so anything it wants to survive
  // that has to live outside it. Optional and opt-in: omitted entirely,
  // behavior is unchanged from before (auto-fit once per (run,tag), no
  // persistence) -- this only applies where a caller explicitly wants
  // "camera state stays put while browsing between nodes" (PipelineView),
  // not other MeshPanel usages (Dashboard, MultiPanel) that show
  // unrelated meshes at unrelated scales and shouldn't inherit it.
  cameraState?: MutableRefObject<CameraState | null>;
  // Controller-mode's right-stick camera orbit -- the CALLER (outside the
  // Canvas, in a plain requestAnimationFrame loop reading gamepad state)
  // continuously overwrites this ref with THIS frame's angular deltas
  // (radians); SceneCamera applies whatever's currently in it once per R3F
  // frame via useFrame. Optional/inert when omitted -- every other
  // MeshPanel usage (Dashboard, PipelineView's mouse-only viewport) is
  // unaffected. Doesn't fight mouse-drag OrbitControls: both just move the
  // same camera/controls.target, whichever last wrote wins that frame.
  externalOrbitRef?: MutableRefObject<{ dAzimuth: number; dPolar: number }>;
  // Color the mesh by one of its per-vertex `fields` (absent or not carried
  // by the shown mesh: plain color). `fieldRange` fixes the colormap range
  // (null: fit the shown mesh). `onFieldsSeen` reports the field names the
  // meshes carry, so a caller can offer them.
  field?: string | null;
  fieldRange?: [number, number] | null;
  onFieldsSeen?: (names: string[]) => void;
  // Draw the meshes' extra `tools` (tooling acting on the part). Default on.
  showTools?: boolean;
}

const MAX_OVERLAY = 20;

// Tooling reads as steel (darker than the part) except the copper coil;
// translucent so the part stays the subject.
const TOOL_STYLE: Record<ResolvedTheme, Record<string, { color: string; opacity: number }>> = {
  dark: {
    die: { color: "#6b7280", opacity: 0.45 }, clamp: { color: "#6b7280", opacity: 0.4 },
    punch: { color: "#a3a9b4", opacity: 0.6 }, blade: { color: "#a3a9b4", opacity: 0.5 },
    coil: { color: "#c8742f", opacity: 0.5 },
  },
  light: {
    die: { color: "#4b5563", opacity: 0.35 }, clamp: { color: "#4b5563", opacity: 0.3 },
    punch: { color: "#5b6270", opacity: 0.5 }, blade: { color: "#5b6270", opacity: 0.45 },
    coil: { color: "#b5651d", opacity: 0.55 },
  },
};

function ToolMeshes({ tools, theme }: { tools: MeshTool[]; theme: ResolvedTheme }) {
  return (
    <>
      {tools.map((t, i) => {
        const style = TOOL_STYLE[theme][t.role ?? ""] ?? TOOL_STYLE[theme].die;
        return (
          <MeshGeometry
            key={i}
            data={{ step: 0, vertices: t.vertices, faces: t.faces }}
            color={style.color}
            opacity={style.opacity}
            transparent={style.opacity < 1}
          />
        );
      })}
    </>
  );
}

function bboxCenter(frame: MeshData): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const v of frame.vertices) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[k]);
      hi[k] = Math.max(hi[k], v[k]);
    }
  }
  return [0.5 * (lo[0] + hi[0]), 0.5 * (lo[1] + hi[1]), 0.5 * (lo[2] + hi[2])];
}

function FieldLegend({ name, unit, lo, hi, locked, kind, theme }: {
  name: string; unit?: string; lo: number; hi: number; locked: boolean; kind: ColormapKind; theme: ResolvedTheme;
}) {
  const span = Math.abs(hi - lo);
  const fmt = (x: number) => (span >= 20 ? x.toFixed(0) : span >= 0.2 ? x.toFixed(2) : x.toPrecision(2));
  return (
    <div className="absolute left-2 bottom-2 z-10 pointer-events-none bg-panel/85 border border-border rounded px-2 py-1.5 text-[10px] text-gray-300 w-48">
      <div className="flex justify-between mb-1">
        <span className="font-semibold">{name}{unit ? ` (${unit})` : ""}</span>
        <span className="text-gray-500">{locked ? "locked" : "auto"}</span>
      </div>
      <div className="h-2.5 rounded-sm" style={{ background: colormapCss(kind, theme) }} />
      <div className="flex justify-between mt-0.5 tabular-nums text-gray-400">
        <span>{fmt(lo)}</span>
        <span>{fmt(0.5 * (lo + hi))}</span>
        <span>{fmt(hi)}</span>
      </div>
    </div>
  );
}

function computeAutoFitState(frame: MeshData): { camPos: [number, number, number]; dist: number } {
  let maxDist = 1;
  for (const v of frame.vertices) {
    const d = Math.hypot(v[0], v[1], v[2]);
    if (d > maxDist) maxDist = d;
  }
  const dist = maxDist * 2.5;
  return { camPos: [dist * 0.55, dist * 0.65, dist * 0.55], dist };
}

// Camera used to be a fixed `position={[0, 6, 4]}` regardless of mesh
// scale -- fine for small content, way too close for a 60mm-long billet
// (looked "reset very close" every time a panel opened). Auto-fits ONCE
// based on the first mesh it ever sees (the vertex bounding radius), then:
// - without `cameraStateRef`: leaves the camera alone afterward, same as
//   before -- fine for a component that never remounts mid-viewing.
// - with `cameraStateRef`: on EVERY mount, restores the ref's last-saved
//   position/target instead of re-auto-fitting (so switching nodes doesn't
//   reset your view), and keeps the ref updated live via OrbitControls'
//   own "change" event (drag/pan/zoom) so the NEXT mount picks it back up.
//   The very first-ever mount (ref still empty) still auto-fits, seeding
//   the ref from the starting mesh -- "reasonable default, then persists."
// Explicit "Fit" (controls bar): frame the CURRENT mesh's bounding box --
// unlike the one-time auto-fit above, which sizes to whatever mesh came first
// (e.g. the short stock of a forging sequence whose later stages are much
// longer). `centered`: the mesh is drawn inside <Center>, so aim at the origin;
// otherwise (overlay) aim at the box center.
function fitToBox(frame: MeshData, centered: boolean): { position: [number, number, number]; target: [number, number, number]; dist: number } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const v of frame.vertices) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[k]);
      hi[k] = Math.max(hi[k], v[k]);
    }
  }
  const half = Math.max(0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1);
  const target: [number, number, number] = centered
    ? [0, 0, 0]
    : [0.5 * (lo[0] + hi[0]), 0.5 * (lo[1] + hi[1]), 0.5 * (lo[2] + hi[2])];
  const dist = half * 2.6;
  return { position: [target[0] + dist * 0.55, target[1] + dist * 0.65, target[2] + dist * 0.55], target, dist };
}

function SceneCamera({
  run, tag, frame, cameraStateRef, externalOrbitRef, refitKey = 0, centered = true,
}: {
  run: string; tag: string; frame?: MeshData; cameraStateRef?: MutableRefObject<CameraState | null>;
  externalOrbitRef?: MutableRefObject<{ dAzimuth: number; dPolar: number }>;
  refitKey?: number; centered?: boolean;
}) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as ControlsLike | null;
  const appliedRef = useRef(false);
  const firedForKey = useRef<string | null>(null);

  useEffect(() => {
    if (refitKey === 0 || !frame) return;
    const { position, target, dist } = fitToBox(frame, centered);
    camera.position.set(...position);
    camera.near = Math.max(dist * 0.01, 0.01);
    camera.far = dist * 20;
    camera.lookAt(...target);
    if ("updateProjectionMatrix" in camera) (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    if (controls) {
      controls.target.set(...target);
      controls.update();
    }
    if (cameraStateRef) cameraStateRef.current = { position, target };
    // Only on an explicit Fit click -- not when the frame or centering changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refitKey]);

  useEffect(() => {
    if (cameraStateRef) {
      // Persistent mode: apply once per MOUNT (a fresh Canvas each time),
      // preferring the saved state over a fresh auto-fit.
      if (appliedRef.current) return;
      const saved = cameraStateRef.current;
      if (saved) {
        camera.position.set(...saved.position);
        camera.near = 0.01;
        camera.far = 100000;
        if ("updateProjectionMatrix" in camera) (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        if (controls) {
          controls.target.set(...saved.target);
          controls.update();
        }
        appliedRef.current = true;
      } else if (frame) {
        const { camPos, dist } = computeAutoFitState(frame);
        camera.position.set(...camPos);
        camera.near = Math.max(dist * 0.01, 0.01);
        camera.far = dist * 20;
        camera.lookAt(0, 0, 0);
        if ("updateProjectionMatrix" in camera) (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        if (controls) {
          controls.target.set(0, 0, 0);
          controls.update();
        }
        cameraStateRef.current = { position: camPos, target: [0, 0, 0] };
        appliedRef.current = true;
      }
      // else: no saved state AND no frame yet -- wait for a frame to arrive.
      return;
    }

    // Non-persistent mode (unchanged from before): fit once per distinct
    // (run, tag) source, never touched again.
    const key = `${run}::${tag}`;
    if (!frame || firedForKey.current === key) return;
    firedForKey.current = key;
    const { camPos, dist } = computeAutoFitState(frame);
    camera.position.set(...camPos);
    camera.near = Math.max(dist * 0.01, 0.01);
    camera.far = dist * 20;
    camera.lookAt(0, 0, 0);
    if ("updateProjectionMatrix" in camera) (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [run, tag, frame, camera, controls, cameraStateRef]);

  // Keep the ref live so the NEXT mount (a different node's tag) picks up
  // wherever the user left off -- "maintains clicked drag state."
  useEffect(() => {
    if (!cameraStateRef || !controls) return;
    const save = () => {
      cameraStateRef.current = {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
    };
    controls.addEventListener("change", save);
    return () => controls.removeEventListener("change", save);
  }, [cameraStateRef, controls, camera]);

  // Right-stick orbit -- standard spherical rotation of the camera around
  // controls.target (NOT moving the target itself), polar angle clamped
  // just short of the poles to avoid the camera flipping/gimbal-locking
  // straight overhead. `externalOrbitRef.current` already holds THIS
  // frame's angular delta (the caller computed it against real elapsed
  // time in its own loop), so this just applies it once per R3F frame --
  // no local timing/accumulation needed here.
  useFrame(() => {
    if (!externalOrbitRef) return;
    const { dAzimuth, dPolar } = externalOrbitRef.current;
    if (dAzimuth === 0 && dPolar === 0) return;
    const target = controls ? controls.target : new THREE.Vector3(0, 0, 0);
    const offset = camera.position.clone().sub(target);
    const radius = offset.length();
    if (radius < 1e-6) return;
    let azimuth = Math.atan2(offset.x, offset.z);
    let polar = Math.acos(THREE.MathUtils.clamp(offset.y / radius, -1, 1));
    azimuth += dAzimuth;
    polar = THREE.MathUtils.clamp(polar + dPolar, 0.1, Math.PI - 0.1);
    offset.set(
      radius * Math.sin(polar) * Math.sin(azimuth),
      radius * Math.cos(polar),
      radius * Math.sin(polar) * Math.cos(azimuth),
    );
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    if (controls) controls.update();
  });

  return null;
}

// ── Geometry ──────────────────────────────────────────────────────────────────

export interface GeoProps {
  data: MeshData;
  color: string;
  opacity: number;
  transparent: boolean;
}

export function MeshGeometry({ data, color, opacity, transparent }: GeoProps) {
  // Empty `faces` is the point-cloud sentinel (forge_net's autocook path
  // pushes the raw tracked point cloud with no triangulation -- real
  // meshing only happens via the separate "Mesh selected" action). With a
  // real triangle mesh, `setIndex([])` + `computeVertexNormals()` on zero
  // triangles renders nothing at all, so this needs its own branch, not a
  // degenerate case of the mesh path below.
  const isPointCloud = data.faces.length === 0;

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(data.vertices.flat()), 3),
    );
    if (!isPointCloud) {
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(data.faces.flat()), 1));
      geo.computeVertexNormals();
    }
    if (data.colors) {
      geo.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array(data.colors.flat()), data.colors[0].length),
      );
    }
    return geo;
  }, [data, isPointCloud]);

  if (isPointCloud) {
    return (
      <points geometry={geometry}>
        <pointsMaterial
          vertexColors={!!data.colors}
          color={data.colors ? undefined : color}
          size={0.6}
          sizeAttenuation
          transparent={transparent}
          opacity={opacity}
          depthWrite={!transparent}
        />
      </points>
    );
  }

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors={!!data.colors}
        color={data.colors ? undefined : color}
        side={THREE.DoubleSide}
        roughness={0.55}
        metalness={0.15}
        transparent={transparent}
        opacity={opacity}
        depthWrite={!transparent}
      />
    </mesh>
  );
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function frameColor(i: number, total: number): string {
  const t = total <= 1 ? 1 : i / (total - 1);
  return `hsl(${Math.round(240 - t * 180)}, 70%, 58%)`;
}

function frameOpacity(i: number, total: number): number {
  return total <= 1 ? 0.7 : 0.12 + 0.63 * (i / (total - 1));
}

function sampleFrames(frames: MeshData[], n: number): MeshData[] {
  if (frames.length <= n) return frames;
  const step = (frames.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => frames[Math.round(i * step)]);
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function MeshPanel({
  run, tag, overlay, onFrameChange, meshOpacity = 1, cameraState, externalOrbitRef,
  field = null, fieldRange = null, onFieldsSeen, showTools = true,
}: Props) {
  const theme = useResolvedTheme();
  const entries = useTagData(run, tag);

  // Dedupe by step, keeping the LAST occurrence -- a `replace=True` push
  // (e.g. re-cooking the same node/sequence tag) clears the server's
  // buffer, but the WebSocket broadcast for that push carries no "this
  // replaced everything" signal, so the frontend's own accumulated
  // `entries` cache just keeps growing with duplicate steps across
  // re-cooks. Array.sort is stable, so without this, `frames.findIndex`
  // below would always resolve to the OLDEST entry for a repeated step --
  // i.e. the displayed mesh would silently freeze on the first cook
  // instead of updating on subsequent ones.
  const frames = useMemo(() => {
    const byStep = new Map<number, MeshData>();
    for (const e of entries) {
      if (e.type !== "mesh") continue;
      const d = e.data as MeshData;
      byStep.set(d.step, d);
    }
    return Array.from(byStep.values()).sort((a, b) => a.step - b.step);
  }, [entries]);

  // Track by STEP NUMBER so new arrivals don't reshuffle the index
  const [currentStep, setCurrentStep] = useState<number>(-1);
  const [playing, setPlaying]   = useState(false);
  const [fps, setFps]           = useState(5);
  const [overlayAll, setOverlay] = useState(false);
  const [refitKey, setRefitKey] = useState(0); // bumped by the "Fit" button
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const userScrubbing = useRef(false);
  // Unique per MeshPanel instance -- multiple can be mounted at once
  // (Dashboard's MultiPanel, this view alongside another), and a
  // <datalist> id must be unique in the DOM for its <input list=...>
  // reference to resolve to the RIGHT one.
  const frameTicksId = useId();

  // Resolve index from step
  const frameIdx = useMemo(() => {
    if (frames.length === 0) return -1;
    const idx = frames.findIndex((f) => f.step === currentStep);
    return idx >= 0 ? idx : frames.length - 1;
  }, [frames, currentStep]);

  const currentFrame = frameIdx >= 0 ? frames[frameIdx] : undefined;

  useEffect(() => {
    if (currentFrame) onFrameChange?.(currentFrame.step);
  }, [currentFrame, onFrameChange]);

  // Auto-advance to latest ONLY when not playing and not scrubbing
  useEffect(() => {
    if (!playing && !userScrubbing.current && frames.length > 0) {
      setCurrentStep(frames[frames.length - 1].step);
    }
  }, [frames.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Playback loop — advance by step value, not index
  const clearLoop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearLoop();
    if (!playing || frames.length === 0) return;
    intervalRef.current = setInterval(() => {
      setCurrentStep((step) => {
        const idx = frames.findIndex((f) => f.step === step);
        if (idx < 0 || idx >= frames.length - 1) {
          setPlaying(false);
          return step;
        }
        return frames[idx + 1].step;
      });
    }, 1000 / fps);
    return clearLoop;
  }, [playing, fps, frames, clearLoop]);

  const togglePlay = () => {
    if (frames.length === 0) return;
    if (!playing && frameIdx >= frames.length - 1) {
      setCurrentStep(frames[0].step);
    }
    setPlaying((p) => !p);
  };

  const overlayFrames = useMemo(() => sampleFrames(frames, MAX_OVERLAY), [frames]);
  const hasMesh = frames.length > 0;

  useEffect(() => {
    if (!onFieldsSeen) return;
    const names = new Set<string>();
    for (const f of frames) for (const k of Object.keys(f.fields ?? {})) names.add(k);
    if (names.size) onFieldsSeen(Array.from(names));
  }, [frames, onFieldsSeen]);

  // The part is centered on its own bounding box (not drei <Center>, which
  // would also count the tooling and shift the view whenever tools appear).
  const center = useMemo(() => (currentFrame ? bboxCenter(currentFrame) : [0, 0, 0]) as [number, number, number],
    [currentFrame]);

  // Colored copy of the current frame when a field is selected and present.
  const colored = useMemo(() => {
    const values = field && currentFrame?.fields?.[field];
    if (!currentFrame || !values || values.length !== currentFrame.vertices.length) return null;
    let lo = Infinity;
    let hi = -Infinity;
    if (fieldRange) {
      [lo, hi] = fieldRange;
    } else {
      for (const x of values) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    // A signed field (values on both sides of 0, e.g. curvature): symmetric
    // range on a diverging map, so white means zero.
    const diverging = lo < 0 && hi > 0;
    if (diverging && !fieldRange) {
      const m = Math.max(-lo, hi);
      lo = -m;
      hi = m;
    }
    if (!(hi - lo > 1e-9 * Math.max(1, Math.abs(hi)))) {
      // a uniform field (e.g. stock straight from the furnace): mid-colormap, not black
      const pad = Math.max(1e-6, 0.05 * Math.abs(hi));
      lo -= pad;
      hi += pad;
    }
    const span = hi - lo;
    const kind = colormapKind(field as string, lo, hi);
    const cmap = colormap(kind, theme);
    // vertex colors are linear in three.js; the colormap (and legend) is sRGB
    const colors = values.map((x) => cmap((x - lo) / span).map((c) => Math.pow(c, 2.2)));
    return { frame: { ...currentFrame, colors }, lo, hi, kind, unit: currentFrame.field_units?.[field as string] };
  }, [currentFrame, field, fieldRange, theme]);

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 3-D viewport */}
      <div className="flex-1 min-h-0 relative">
        {!hasMesh && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none z-10">
            No mesh data yet{overlay ? " — showing press preview" : ""}
          </div>
        )}
        {colored && !overlayAll && field && (
          <FieldLegend name={field} unit={colored.unit} lo={colored.lo} hi={colored.hi} locked={!!fieldRange}
                       kind={colored.kind} theme={theme} />
        )}
        <Canvas camera={{ position: [0, 6, 4], fov: 45 }} shadows gl={{ antialias: true }}>
          <color attach="background" args={[CHROME[theme].viewport]} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
          <directionalLight position={[-5, -3, -5]} intensity={0.3} />
          <SceneCamera run={run} tag={tag} frame={currentFrame} cameraStateRef={cameraState} externalOrbitRef={externalOrbitRef}
                       refitKey={refitKey} centered={!overlayAll} />

          {overlayAll ? (
            // No <Center> in overlay — frames sit in their natural coordinate
            // space so the fixed anvil end stays aligned across all frames.
            // Press preview (if any) uses the same raw/uncentered frame here.
            <>
              {overlayFrames.map((f, i) => (
                <MeshGeometry
                  key={f.step}
                  data={f}
                  color={frameColor(i, overlayFrames.length)}
                  opacity={frameOpacity(i, overlayFrames.length)}
                  transparent
                />
              ))}
              {overlay}
            </>
          ) : currentFrame ? (
            // Press preview and tooling rendered INSIDE the same centering
            // group as the mesh so they shift together with it.
            <group position={[-center[0], -center[1], -center[2]]}>
              <MeshGeometry
                key={colored ? "field" : "plain"}  // vertexColors on/off needs a fresh material
                data={colored ? colored.frame : currentFrame}
                color={CHROME[theme].part}
                opacity={meshOpacity}
                transparent={meshOpacity < 1}
              />
              {showTools && currentFrame.tools && <ToolMeshes tools={currentFrame.tools} theme={theme} />}
              {overlay}
            </group>
          ) : (
            // No cooked mesh yet -- still show the preview (uncentered; no
            // billet to reference for centering yet) so a freshly-added,
            // not-yet-cooked node can still be positioned by eye.
            overlay
          )}

          <OrbitControls makeDefault />
          <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
            <GizmoViewport axisColors={["#e34948", "#008300", "#2a78d6"]} labelColor={theme === "dark" ? "white" : "black"} />
          </GizmoHelper>
        </Canvas>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-t border-border bg-panel shrink-0 text-xs text-gray-400">
        <button
          onClick={togglePlay}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-border transition-colors text-gray-300 shrink-0">
          {playing ? "⏸" : "▶"}
        </button>

        <span className="tabular-nums shrink-0 text-gray-500">
          {frameIdx + 1}/{frames.length} · step {currentFrame?.step ?? 0}
        </span>

        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={Math.max(0, frameIdx)}
          onMouseDown={() => { userScrubbing.current = true; setPlaying(false); }}
          onMouseUp={() => { userScrubbing.current = false; }}
          onChange={(e) => {
            const idx = Number(e.target.value);
            if (frames[idx]) setCurrentStep(frames[idx].step);
          }}
          list={frames.length > 1 ? frameTicksId : undefined}
          className="flex-1 accent-accent"
        />
        {/* Native tick marks, one per hit -- "which hit am I on, how many
            total" at a glance instead of only the text readout above.
            Native <input list> rendering is Chromium/Firefox-supported;
            harmless no-op elsewhere (falls back to a plain slider). */}
        {frames.length > 1 && (
          <datalist id={frameTicksId}>
            {frames.map((_, i) => <option key={i} value={i} />)}
          </datalist>
        )}

        <button
          onClick={() => setRefitKey((k) => k + 1)}
          disabled={!currentFrame}
          title="Fit the view to the current mesh"
          className="px-1.5 h-6 rounded hover:bg-border transition-colors text-gray-300 shrink-0 disabled:opacity-40">
          Fit
        </button>

        <label className="flex items-center gap-1 shrink-0 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={overlayAll}
            onChange={(e) => setOverlay(e.target.checked)}
            className="accent-accent"
          />
          <span>Overlay</span>
        </label>

        <span className="shrink-0">FPS</span>
        <input
          type="range" min={1} max={30} value={fps}
          onChange={(e) => setFps(Number(e.target.value))}
          className="w-14 accent-accent"
        />
        <span className="w-5 text-right tabular-nums shrink-0">{fps}</span>
      </div>
    </div>
  );
}
