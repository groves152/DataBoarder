// Colormaps for scalar fields on meshes, chosen by what the field encodes:
//   - temperature: "inferno" (black-body like, monotone in lightness) -- reads
//     as heat at a glance; the one multi-hue map, and still never a rainbow
//   - magnitude (strain, stress, rates...): one hue, blue, light -> dark
//     (the palette's sequential ramp); in dark mode it runs dark -> light so
//     "near zero" recedes into the background, as on light
//   - signed (curvature): blue <-> red with a neutral gray midpoint
// All are sRGB in 0..1; three.js vertex colors need linearizing (MeshPanel).
import type { ResolvedTheme } from "@/theme";

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;

function ramp(stops: RGB[], t: number): RGB {
  const x = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}

const css = (stops: RGB[]) =>
  `linear-gradient(to right, ${stops
    .map((c, i) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")}) ${((i / (stops.length - 1)) * 100).toFixed(1)}%`)
    .join(", ")})`;

// matplotlib inferno, sampled
const INFERNO: RGB[] = [
  [0.001, 0.0, 0.014], [0.122, 0.047, 0.282], [0.336, 0.06, 0.43], [0.533, 0.134, 0.416], [0.729, 0.212, 0.333],
  [0.89, 0.348, 0.198], [0.978, 0.553, 0.039], [0.982, 0.782, 0.176], [0.988, 0.998, 0.645],
];
// palette sequential blue, steps 100..700
const BLUE: RGB[] = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"].map(hex);
// diverging: blue arm, gray midpoint (per mode), red arm -- equal steps per arm
const DIV_BLUE: RGB[] = ["#0d366b", "#256abf", "#6da7ec"].map(hex);
const DIV_RED: RGB[] = ["#e66767", "#c43a3a", "#7f1d1d"].map(hex);
const DIV_MID: Record<ResolvedTheme, RGB> = { light: hex("#f0efec"), dark: hex("#383835") };

export type ColormapKind = "temperature" | "sequential" | "diverging";

function stopsFor(kind: ColormapKind, theme: ResolvedTheme): RGB[] {
  if (kind === "temperature") return INFERNO;
  if (kind === "diverging") return [...DIV_BLUE, DIV_MID[theme], ...DIV_RED];
  return theme === "dark" ? [...BLUE].reverse() : BLUE;
}

/** Which map a field gets: temperature by name, signed data diverging, else sequential. */
export function colormapKind(field: string, lo: number, hi: number): ColormapKind {
  if (/^t(_c|emp)/i.test(field) || field === "T") return "temperature";
  return lo < 0 && hi > 0 ? "diverging" : "sequential";
}

export function colormap(kind: ColormapKind, theme: ResolvedTheme): (t: number) => RGB {
  const stops = stopsFor(kind, theme);
  return (t) => ramp(stops, t);
}

export function colormapCss(kind: ColormapKind, theme: ResolvedTheme): string {
  return css(stopsFor(kind, theme));
}
