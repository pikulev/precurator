import { END } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { resolveIterationOutcome, shouldContinue } from "../../src";

describe("shouldContinue", () => {
  it("returns END when epsilon is reached", () => {
    expect(
      shouldContinue({
        status: "optimizing",
        errorScore: 0.04,
        epsilon: 0.05
      })
    ).toBe(END);
  });

  it("returns END for terminal statuses", () => {
    expect(
      shouldContinue({
        status: "failed",
        errorScore: 0.8,
        epsilon: 0.05
      })
    ).toBe(END);
  });

  it("routes to interrupt for human intervention", () => {
    expect(
      shouldContinue({
        status: "awaiting_human_intervention",
        errorScore: 0.8,
        epsilon: 0.05
      })
    ).toBe("interrupt");
  });

  it("continues observing while optimization is still in progress", () => {
    expect(
      shouldContinue({
        status: "optimizing",
        errorScore: 0.4,
        epsilon: 0.05
      })
    ).toBe("observe");
  });
});

describe("resolveIterationOutcome", () => {
  it("marks a non-improving error sequence as stuck (no-progress)", () => {
    const outcome = resolveIterationOutcome({
      errorScore: 0.4,
      epsilon: 0.05,
      errorTrend: "improving",
      iteration: 1,
      maxIterations: 5,
      errorHistory: [0.2, 0.3, 0.4]
    });

    expect(outcome.status).toBe("stuck");
    expect(outcome.stopReason).toBe("no-progress");
    expect(outcome.diagnostics?.code).toBe("no-progress");
    expect(outcome.diagnostics?.evidence).toMatchObject({
      recentHistory: [0.2, 0.3, 0.4]
    });
  });
});
