export interface SessionAgeMetrics {
  count: number;
  newestMs: number | null;
  averageMs: number | null;
  p95Ms: number | null;
  oldestMs: number | null;
}

/** Summarize ages from creation/touch timestamps without exposing session IDs. */
export function summarizeSessionAges(
  timestamps: Iterable<number>,
  now = Date.now(),
): SessionAgeMetrics {
  const ages = Array.from(timestamps, (timestamp) =>
    Math.max(0, now - timestamp),
  ).sort((a, b) => a - b);

  if (ages.length === 0) {
    return {
      count: 0,
      newestMs: null,
      averageMs: null,
      p95Ms: null,
      oldestMs: null,
    };
  }

  const total = ages.reduce((sum, age) => sum + age, 0);
  const p95Index = Math.max(0, Math.ceil(ages.length * 0.95) - 1);

  return {
    count: ages.length,
    newestMs: ages[0],
    averageMs: Math.round(total / ages.length),
    p95Ms: ages[p95Index],
    oldestMs: ages[ages.length - 1],
  };
}
