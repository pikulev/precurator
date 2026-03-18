import { describe, expect, it } from "vitest";

import {
  deriveErrorTrend,
  deterministicComparator
} from "../../src";

describe("deterministicComparator", () => {
  it("calculates a normalized errorScore for structured data", () => {
    const result = deterministicComparator({
      target: {
        profile: {
          score: 10,
          ready: true
        },
        tags: ["stable", "typed"]
      },
      current: {
        profile: {
          score: 4,
          ready: false
        },
        tags: ["stable", "drifting"]
      }
    });

    expect(result.errorScore).toBeGreaterThan(0);
    expect(result.errorScore).toBeLessThan(1);
    expect(result.errorVector["profile.score"]).toBe(1);
    expect(result.errorVector["profile.ready"]).toBe(1);
    expect(result.errorVector["tags[1]"]).toBe(1);
  });
});

describe("deriveErrorTrend", () => {
  it("marks a rebound in error as degrading", () => {
    expect(deriveErrorTrend([0.5, 0.3, 0.4])).toBe("degrading");
  });

  it("detects oscillation on alternating error jumps", () => {
    expect(deriveErrorTrend([0.1, 0.8, 0.1, 0.8])).toBe("oscillating");
  });
});
