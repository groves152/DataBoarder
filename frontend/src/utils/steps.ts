// A program step in shop terms -- what it is, where on the bar, at what angle,
// with what setting -- for the setup sheet and the program compare. Knows the
// cdyn.ops node kinds (forge-genie ops_nodes); anything else gets its params
// listed as they are.
import type { ParamValue } from "@/types/pipeline";

export interface StepDescription {
  op: string;
  where: string; // stock position, mm
  angle: string; // die angle, degrees
  setting: string;
}

type Params = Record<string, ParamValue>;

const n = (v: ParamValue | undefined, digits = 1) => (typeof v === "number" ? v.toFixed(digits) : String(v ?? ""));
const deg = (v: ParamValue | undefined) => (typeof v === "number" ? `${Math.round((v * 180) / Math.PI)}°` : "");
const chain = (p: Params) => (Number(p.chain ?? 0) > 0 ? ` (prong ${p.chain})` : "");

export function describeStep(kind: string, p: Params): StepDescription {
  switch (kind) {
    case "ops_stock":
      return { op: "Stock", where: "", angle: "",
               setting: `D${n(2 * Number(p.radius))} × ${n(p.length)} mm at ${n(p.T_C, 0)} °C, grip ${n(p.grip_length)} mm` };
    case "ops_strike":
      return { op: `Strike${chain(p)}`, where: n(p.s0), angle: deg(p.phi), setting: `gap ${n(p.rho)} mm` };
    case "ops_draw_pass":
      return { op: `Draw pass, ${p.n} hits${chain(p)}`, where: `${n(p.s0_start)}–${n(p.s0_end)}`, angle: deg(p.phi),
               setting: `gap ${n(p.rho)} mm` };
    case "ops_bend":
      return { op: `Bend${chain(p)}`, where: n(p.s0_start), angle: "",
               setting: `wrap ${deg(p.wrap_angle)} on R${n(p.die_radius)} die, side ${p.side}, plane ${p.axis}` };
    case "ops_pierce":
      return { op: "Pierce", where: `${n(p.pos)}${p.position_mode === "from_end" ? " from end" : ""}`, angle: deg(p.theta),
               setting: `punch R${n(p.punch_radius)}, depth ${n(p.depth)} mm, ${p.backing ?? "anvil"}` };
    case "ops_slit":
      return { op: `Slit${chain(p)}`, where: n(p.s0_split), angle: deg(p.theta_n),
               setting: `blade ${n(p.kerf_mm)} × ${n(p.blade_len_mm, 0)} mm` };
    case "ops_regrip":
      return { op: "Regrip", where: "", angle: "", setting: "" };
    case "ops_induction_heat":
      return { op: `Induction heat${chain(p)}`, where: n(p.s0_center), angle: "",
               setting: `${n(p.seconds, 0)} s at ≤${n(p.power_kW, 0)} kW` +
                        (Number(p.T_set_C) > 0 ? `, set ${n(p.T_set_C, 0)} °C` : "") };
    case "ops_heat":
      return { op: `Heat${chain(p)}`, where: `${n(p.s0_lo)}–${n(p.s0_hi)}`, angle: "",
               setting: `${n(p.T_C, 0)} °C${Number(p.seconds) > 0 ? `, ${n(p.seconds, 0)} s` : ""}` };
    case "ops_dwell":
      return { op: "Dwell", where: "", angle: "", setting: `${n(p.seconds, 0)} s in air` };
    default:
      return { op: kind.replace(/^ops_/, "").replace(/_/g, " "), where: "", angle: "",
               setting: Object.entries(p).filter(([k]) => k !== "label").map(([k, v]) => `${k} ${n(v, 2)}`).join(", ") };
  }
}

/** The params two same-kind steps set differently, as "name a → b". */
export function paramDiff(a: Params, b: Params): string[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== "label");
  const fmt = (v: ParamValue | undefined) => (typeof v === "number" ? +v.toFixed(3) : v ?? "—");
  return keys.filter((k) => fmt(a[k]) !== fmt(b[k])).map((k) => `${k} ${fmt(a[k])} → ${fmt(b[k])}`);
}
