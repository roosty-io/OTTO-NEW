export function clamp(n: number, min = 0, max = 100): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function weightedAverage(parts: Array<{ value: number; weight: number }>): number {
  let total = 0;
  let weight = 0;
  for (const p of parts) {
    total += p.value * p.weight;
    weight += p.weight;
  }
  if (weight === 0) return 0;
  return total / weight;
}

export function inverse100(score: number): number {
  return clamp(100 - score);
}
