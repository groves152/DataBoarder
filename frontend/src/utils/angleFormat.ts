// Formats a radian value as a simplified fraction of pi (e.g. "pi/2", "pi",
// "3pi/4") when it's close to a common one, else falls back to a plain
// decimal -- reading "1.57" as "which fraction of a turn is that" is slow;
// "π/2" is immediate, and phi's own symmetry presets (square/hex/octagon,
// see pipelineStore.ts) all land on exactly these simple fractions anyway.
export function formatRadiansAsPi(rad: number, decimals = 2): string {
  const twoPi = 2 * Math.PI;
  let r = rad % twoPi;
  if (r < 0) r += twoPi;
  const fracOfPi = r / Math.PI; // 0..2

  const tolerance = 1e-3;
  for (let denom = 1; denom <= 12; denom++) {
    const numer = Math.round(fracOfPi * denom);
    if (Math.abs(fracOfPi - numer / denom) < tolerance) {
      if (numer === 0) return "0";
      const g = gcd(numer, denom);
      const n = numer / g;
      const d = denom / g;
      const coeff = n === 1 ? "" : String(n);
      return d === 1 ? `${coeff}π` : `${coeff}π/${d}`;
    }
  }
  return rad.toFixed(decimals);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
