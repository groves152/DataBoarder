import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Center, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { useTagData } from "@/hooks/useTagData";
import type { MeshData } from "@/types";

interface Props { run: string; tag: string }

const MAX_OVERLAY = 20;

// Camera used to be a fixed `position={[0, 6, 4]}` regardless of mesh
// scale -- fine for small content, way too close for a 60mm-long billet
// (looked "reset very close" every time a panel opened). Instead, frame
// the camera once per distinct (run, tag) source based on the actual
// vertex bounding radius, and leave it alone afterward so scrubbing/
// playback doesn't jitter the view every frame.
function AutoFitCamera({ run, tag, frame }: { run: string; tag: string; frame?: MeshData }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null;
  const firedForKey = useRef<string | null>(null);

  useEffect(() => {
    const key = `${run}::${tag}`;
    if (!frame || firedForKey.current === key) return;
    firedForKey.current = key;

    let maxDist = 1;
    for (const v of frame.vertices) {
      const d = Math.hypot(v[0], v[1], v[2]);
      if (d > maxDist) maxDist = d;
    }
    const dist = maxDist * 2.5;

    camera.position.set(dist * 0.55, dist * 0.65, dist * 0.55);
    camera.near = Math.max(dist * 0.01, 0.01);
    camera.far = dist * 20;
    camera.lookAt(0, 0, 0);
    if ("updateProjectionMatrix" in camera) {
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [run, tag, frame, camera, controls]);

  return null;
}

// ── Geometry ──────────────────────────────────────────────────────────────────

interface GeoProps {
  data: MeshData;
  color: string;
  opacity: number;
  transparent: boolean;
}

function MeshGeometry({ data, color, opacity, transparent }: GeoProps) {
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

export function MeshPanel({ run, tag }: Props) {
  const entries = useTagData(run, tag);

  const frames = useMemo(
    () =>
      entries
        .filter((e) => e.type === "mesh")
        .map((e) => e.data as MeshData)
        .sort((a, b) => a.step - b.step),
    [entries],
  );

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

  if (frames.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No mesh data yet
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 3-D viewport */}
      <div className="flex-1 min-h-0">
        <Canvas camera={{ position: [0, 6, 4], fov: 45 }} shadows gl={{ antialias: true }}>
          <color attach="background" args={["#0f1117"]} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
          <directionalLight position={[-5, -3, -5]} intensity={0.3} />
          <AutoFitCamera run={run} tag={tag} frame={currentFrame} />

          {overlayAll ? (
            // No <Center> in overlay — frames sit in their natural coordinate
            // space so the fixed anvil end stays aligned across all frames.
            overlayFrames.map((f, i) => (
              <MeshGeometry
                key={f.step}
                data={f}
                color={frameColor(i, overlayFrames.length)}
                opacity={frameOpacity(i, overlayFrames.length)}
                transparent
              />
            ))
          ) : (
            currentFrame && (
              <Center>
                <MeshGeometry
                  data={currentFrame}
                  color="#7c6af7"
                  opacity={1}
                  transparent={false}
                />
              </Center>
            )
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
