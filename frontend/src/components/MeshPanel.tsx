import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Center, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useMemo, useState, useEffect, useRef, useCallback, type ReactNode, type MutableRefObject } from "react";
import * as THREE from "three";
import { useTagData } from "@/hooks/useTagData";
import type { MeshData } from "@/types";

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
}

const MAX_OVERLAY = 20;

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
function SceneCamera({
  run, tag, frame, cameraStateRef,
}: { run: string; tag: string; frame?: MeshData; cameraStateRef?: MutableRefObject<CameraState | null> }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as ControlsLike | null;
  const appliedRef = useRef(false);
  const firedForKey = useRef<string | null>(null);

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
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(data.vertices.flat()), 3),
    );
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(data.faces.flat()), 1));
    geo.computeVertexNormals();
    if (data.colors) {
      geo.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array(data.colors.flat()), data.colors[0].length),
      );
    }
    return geo;
  }, [data]);

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

export function MeshPanel({ run, tag, overlay, onFrameChange, meshOpacity = 1, cameraState }: Props) {
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
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const userScrubbing = useRef(false);

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

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 3-D viewport */}
      <div className="flex-1 min-h-0 relative">
        {!hasMesh && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none z-10">
            No mesh data yet{overlay ? " — showing press preview" : ""}
          </div>
        )}
        <Canvas camera={{ position: [0, 6, 4], fov: 45 }} shadows gl={{ antialias: true }}>
          <color attach="background" args={["#0f1117"]} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
          <directionalLight position={[-5, -3, -5]} intensity={0.3} />
          <SceneCamera run={run} tag={tag} frame={currentFrame} cameraStateRef={cameraState} />

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
            // Press preview rendered INSIDE the same <Center> as the mesh so
            // it shifts together with it, not just in raw/uncentered space.
            <Center>
              <MeshGeometry
                data={currentFrame}
                color="#7c6af7"
                opacity={meshOpacity}
                transparent={meshOpacity < 1}
              />
              {overlay}
            </Center>
          ) : (
            // No cooked mesh yet -- still show the preview (uncentered; no
            // billet to reference for centering yet) so a freshly-added,
            // not-yet-cooked node can still be positioned by eye.
            overlay
          )}

          <OrbitControls makeDefault />
          <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
            <GizmoViewport axisColors={["#f97316", "#4ade80", "#60a5fa"]} labelColor="white" />
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
          className="flex-1 accent-accent"
        />

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
