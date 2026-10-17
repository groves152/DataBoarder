// A program's headline numbers from its nodes and their last cook's
// diagnostics (forge-genie ops_diagnostics): shared by the program cards,
// the compare table and the setup sheet.
import type { Node } from "@xyflow/react";
import type { NodeDiagnostics, PipelineNodeData } from "@/types/pipeline";

export interface ProgramStats {
  nodes: number;
  hits: number;
  heats: number;
  otherOps: number; // bends, pierces, slits, regrips
  cooked: boolean;
  lengthMm: number | null; // of the final part
  dMinMm: number | null;
  dMaxMm: number | null;
  roughness: number | null;
  strainMax: number | null;
  timeS: number | null; // process clock at the end
  peakLoadKN: number | null;
  coldestHitC: number | null; // the coldest part temperature any press step saw
  cappedHits: number;
}

const HIT_KINDS = new Set(["ops_strike", "slab_strike"]);
const PRESS_KINDS = new Set(["ops_strike", "ops_draw_pass", "slab_strike"]);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function programStats(
  nodeIds: string[], byId: Map<string, Node<PipelineNodeData>>, diagnostics: Record<string, NodeDiagnostics>,
): ProgramStats {
  const steps = nodeIds.map((id) => byId.get(id)).filter((n) => n !== undefined);
  const kinds = steps.map((s) => s.data.kind);
  const last = diagnostics[nodeIds[nodeIds.length - 1]];
  const diags = nodeIds.map((id) => diagnostics[id]).filter((d) => d !== undefined);
  const loads = diags.map((d) => num(d.required_load_N) ?? num(d.required_load_N_max)).filter((v) => v !== null);
  const pressT = steps.filter((s) => PRESS_KINDS.has(s.data.kind))
    .map((s) => num(diagnostics[s.id]?.T_min_C) ?? num(diagnostics[s.id]?.T_part_min_C)).filter((v) => v !== null);
  return {
    nodes: steps.length,
    hits: steps.reduce((sum, s) => sum + (HIT_KINDS.has(s.data.kind) ? 1
      : s.data.kind === "ops_draw_pass" ? Number(s.data.params.n ?? 0) : 0), 0),
    heats: kinds.filter((k) => k.includes("heat")).length,
    otherOps: kinds.filter((k) => /bend|pierce|slit|regrip/.test(k)).length,
    cooked: steps.length > 0 && steps.every((s) => s.data.cooked),
    lengthMm: num(last?.length_mm),
    dMinMm: num(last?.d_eq_min_mm),
    dMaxMm: num(last?.d_eq_max_mm),
    roughness: num(last?.roughness),
    strainMax: num(last?.strain_max),
    timeS: num(last?.time_s),
    peakLoadKN: loads.length ? Math.max(...loads) / 1e3 : null,
    coldestHitC: pressT.length ? Math.min(...pressT) : null,
    cappedHits: diags.reduce((sum, d) => sum + (num(d.n_capped) ?? (d.capped ? 1 : 0)), 0),
  };
}
