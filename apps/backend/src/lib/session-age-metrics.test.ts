import { describe, expect, it } from "vitest";

import { summarizeSessionAges } from "./session-age-metrics";

describe("summarizeSessionAges", () => {
  it("returns empty metrics for no sessions", () => {
    expect(summarizeSessionAges([], 10_000)).toEqual({
      count: 0,
      newestMs: null,
      averageMs: null,
      p95Ms: null,
      oldestMs: null,
    });
  });

  it("returns aggregate ages without identifiers", () => {
    expect(summarizeSessionAges([9_000, 7_000, 5_000], 10_000)).toEqual({
      count: 3,
      newestMs: 1_000,
      averageMs: 3_000,
      p95Ms: 5_000,
      oldestMs: 5_000,
    });
  });

  it("clamps future timestamps to zero", () => {
    expect(summarizeSessionAges([11_000], 10_000).newestMs).toBe(0);
  });
});
