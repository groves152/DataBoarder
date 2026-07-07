import { useState, useEffect, useRef } from "react";
import { useTagData } from "@/hooks/useTagData";
import type { AnimationFrameData } from "@/types";

interface Props { run: string; tag: string; fps?: number }

export function AnimationPanel({ run, tag, fps = 10 }: Props) {
  const entries = useTagData(run, tag);
  const frames = entries.map((e) => e.data as AnimationFrameData);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (playing) {
      intervalRef.current = window.setInterval(() => {
        setCursor((c) => (c + 1) % Math.max(frames.length, 1));
      }, 1000 / fps);
    }
    return () => { if (intervalRef.current !== null) clearInterval(intervalRef.current); };
  }, [playing, frames.length, fps]);

  const current = frames[cursor];

  return (
    <div className="flex flex-col h-full p-2 gap-2">
      <div className="flex-1 flex items-center justify-center bg-surface rounded">
        {current?.png_b64
          ? <img src={`data:image/png;base64,${current.png_b64}`} alt={`${tag} frame ${cursor}`}
              className="max-w-full max-h-full object-contain" />
          : <span className="text-gray-400 text-sm">
              {frames.length === 0 ? "No frames yet" : `Frame ${cursor}`}
            </span>
        }
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => setPlaying((p) => !p)}
          className="px-3 py-1 rounded bg-accent text-white text-xs">
          {playing ? "Pause" : "Play"}
        </button>
        <input type="range" min={0} max={Math.max(frames.length - 1, 0)} value={cursor}
          onChange={(e) => setCursor(Number(e.target.value))} className="flex-1" />
        <span className="text-xs text-gray-400 tabular-nums">
          {cursor}/{Math.max(frames.length - 1, 0)}
        </span>
      </div>
    </div>
  );
}
