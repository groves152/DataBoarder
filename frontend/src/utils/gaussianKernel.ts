// Ports `forge_search.slab.smoothing.axial_gaussian_kernel`'s SHAPE
// function to JS for a live, client-side "what does this smoothing kernel
// look like" plot -- computing this server-side would add network lag to
// every slider tick, and the formula is simple enough to keep in exact
// sync by hand (both sides cite each other).
//
// Python (smoothing.py): kernel = exp(-0.5 * (dist / decay)^power), with
// decay<=0 reproducing the ORIGINAL hard-edged behavior exactly (identity
// -- weight 1 at distance 0, 0 elsewhere). Row-normalization (dividing by
// the sum over the actual discrete z grid) is NOT reproduced here since
// it depends on slab spacing/count, which isn't meaningful for an
// abstract "kernel shape" plot -- this is the pre-normalization weight
// function, the part that actually defines the curve's SHAPE.
// Default sample half-range for sampleKernelProfile -- exported so
// TuningPanel's hard-edge annotations can shade the exact same x-span
// without duplicating the magic number.
export const KERNEL_PLOT_RANGE_MM = 15;

export function gaussianKernelWeight(distanceMm: number, decayMm: number, power: number): number {
  if (decayMm <= 0) return distanceMm === 0 ? 1 : 0;
  return Math.exp(-0.5 * Math.pow(Math.abs(distanceMm) / decayMm, power));
}

// Samples the two-sided (ahead/behind) kernel shape from -rangeMm to
// +rangeMm, `nPoints` samples on each side of 0 -- matches
// axial_gaussian_kernel's own direction split (z > hit_x uses decayAhead,
// else decayBehind). Also reports which side(s), if any, are "hard-edged"
// (decay<=0, the ORIGINAL pre-smoothing slab model's identity kernel --
// see smoothing.py's axial_gaussian_kernel docstring) -- that side's own
// weight function is a true delta (1 at distance 0, exactly 0 everywhere
// else), which samples as a single lone spike here; the caller uses this
// flag to annotate that as intentional instead of leaving it looking like
// a broken/empty chart.
export function sampleKernelProfile(
  decayAheadMm: number, decayBehindMm: number, power: number, rangeMm = KERNEL_PLOT_RANGE_MM, nPoints = 121,
): { x: number[]; y: number[]; aheadHardEdge: boolean; behindHardEdge: boolean } {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < nPoints; i++) {
    const d = -rangeMm + (2 * rangeMm * i) / (nPoints - 1);
    const decay = d > 0 ? decayAheadMm : decayBehindMm;
    x.push(d);
    y.push(gaussianKernelWeight(d, decay, power));
  }
  return { x, y, aheadHardEdge: decayAheadMm <= 0, behindHardEdge: decayBehindMm <= 0 };
}
