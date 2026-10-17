/**
 * Exponential moving average — matches TensorBoard's smoothing algorithm.
 * weight=0 → no smoothing, weight→1 → heavy smoothing.
 * Uses the bias-corrected form so the smoothed curve doesn't lag at the start.
 */
export function ema(values: number[], weight: number): number[] {
  if (weight <= 0) return values;
  const out: number[] = [];
  let last = 0; // the bias correction assumes the average starts from zero
  let debias = 1.0;
  for (const v of values) {
    last = last * weight + v * (1 - weight);
    debias *= weight;
    out.push(last / (1 - debias));
  }
  return out;
}

/** Simple centred moving average with a given window size. */
export function movingAverage(values: number[], window: number): number[] {
  if (window <= 1) return values;
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    return sum / (hi - lo + 1);
  });
}
