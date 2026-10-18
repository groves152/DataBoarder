import { useEffect, useMemo, useState } from "react";
import type { NodeKindSchema } from "@/types/pipeline";

// Pie-style node menu: a ring of circular category buttons around the point it
// was opened at; picking a category fans its node kinds out on an outer arc
// (a single-kind category adds that kind directly). Opened from the graph's
// floating "+" button or by right-click / Tab on the canvas.

const CATEGORY_ORDER = ["stock", "goal", "control", "press", "bend", "cut", "handling", "thermal", "slab (legacy)", "forge-net", "other"];
const CATEGORY_ICON: Record<string, string> = {
  stock: "▮", goal: "◉", control: "⟳", press: "⬍", bend: "↪", cut: "✂", handling: "⇄", thermal: "🔥", "slab (legacy)": "▤",
  "forge-net": "◎", other: "•",
};

const R_CATEGORY = 82; // ring radius, px
const R_KIND = 160;
const CAT_SIZE = 50; // circle diameters
const KIND_SIZE = 58;
const KIND_STEP_DEG = 30;

function kindLabel(kind: string): string {
  return kind.replace(/^(ops|slab|forge_net)_/, "").replace(/_/g, " ");
}

interface Props {
  x: number; // screen position of the center
  y: number;
  kinds: NodeKindSchema[];
  onPick: (kind: string) => void;
  onClose: () => void;
}

export function RadialMenu({ x, y, kinds, onPick, onClose }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(false); // drives the scale-in

  const groups = useMemo(() => {
    const by = new Map<string, NodeKindSchema[]>();
    for (const k of kinds) {
      const c = k.category ?? "other";
      by.set(c, [...(by.get(c) ?? []), k]);
    }
    const order = (c: string) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
    return [...by.entries()].sort((a, b) => order(a[0]) - order(b[0]));
  }, [kinds]);

  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // keep the whole menu on screen
  const pad = R_KIND + KIND_SIZE;
  const cx = Math.min(Math.max(x, pad), window.innerWidth - pad);
  const cy = Math.min(Math.max(y, pad), window.innerHeight - pad);

  const catAngle = (i: number) => -90 + (360 / groups.length) * i; // start at 12 o'clock
  const openIdx = groups.findIndex(([c]) => c === open);
  const openKinds = openIdx >= 0 ? groups[openIdx][1] : [];

  const circle = (size: number, angleDeg: number, radius: number) => {
    const a = (angleDeg * Math.PI) / 180;
    return {
      left: cx + radius * Math.cos(a) - size / 2,
      top: cy + radius * Math.sin(a) - size / 2,
      width: size,
      height: size,
    };
  };

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        className="absolute inset-0 transition-opacity duration-150"
        style={{ opacity: shown ? 1 : 0, background: "radial-gradient(circle at " + `${cx}px ${cy}px` + ", rgb(0 0 0 / 0.25), transparent 260px)" }}
      />
      <div
        className="absolute inset-0 transition-transform duration-150 ease-out"
        style={{ transform: shown ? "scale(1)" : "scale(0.7)", transformOrigin: `${cx}px ${cy}px` }}
      >
        <button
          title="Close (Esc)"
          className="absolute rounded-full bg-panel border border-border text-gray-400 hover:text-gray-100 shadow-lg flex items-center justify-center text-sm"
          style={circle(36, 0, 0)}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          ✕
        </button>

        {groups.map(([cat, list], i) => {
          const active = cat === open;
          return (
            <div key={cat} className="absolute" style={circle(CAT_SIZE, catAngle(i), R_CATEGORY)}>
              <button
                title={`${cat} (${list.length})`}
                className={`w-full h-full rounded-full border shadow-lg flex items-center justify-center text-lg transition-colors ${
                  active ? "bg-accent border-accent text-white" : "bg-panel border-border text-gray-200 hover:border-accent"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (list.length === 1) onPick(list[0].kind);
                  else setOpen(active ? null : cat);
                }}
              >
                {CATEGORY_ICON[cat] ?? CATEGORY_ICON.other}
              </button>
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-0.5 text-[10px] whitespace-nowrap text-gray-300 pointer-events-none">
                {cat}
              </div>
            </div>
          );
        })}

        {openKinds.map((k, j) => {
          const angle = catAngle(openIdx) + (j - (openKinds.length - 1) / 2) * KIND_STEP_DEG;
          return (
            <button
              key={k.kind}
              title={k.kind}
              className="absolute rounded-full bg-panel border border-accent/70 text-gray-100 shadow-lg hover:bg-accent hover:text-white transition-colors flex items-center justify-center text-center leading-tight px-1 text-[10px]"
              style={circle(KIND_SIZE, angle, R_KIND)}
              onClick={(e) => { e.stopPropagation(); onPick(k.kind); }}
            >
              {kindLabel(k.kind)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
