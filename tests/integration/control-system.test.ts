import { describe, expect, it } from "vitest";
import { z } from "zod";

import { compileControlSystem } from "../../src";

describe("compileControlSystem", () => {
  it("validates input and converges when target equals current", async () => {
    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 5
      }
    });

    const snapshot = await system.invoke({
      target: { value: 1 },
      current: { value: 1 }
    });

    expect(snapshot.runtime.status).toBe("converged");
    expect(snapshot.runtime.stopReason).toBe("epsilon-reached");
    expect(snapshot.control.errorScore).toBe(0);
  });

  it("supports interrupt and resume without losing k", async () => {
    const system = compileControlSystem({
      stopPolicy: {
        epsilon: 0,
        maxIterations: 5
      }
    });

    const started = await system.invoke({
      target: { value: 10 },
      current: { value: 0 },
      simulation: true
    });
    const interrupted = await system.interrupt(started, {
      reason: "manual-review"
    });
    const resumed = await system.resume(interrupted, {
      current: { value: 10 },
      humanDecision: {
        action: "resume"
      }
    });

    expect(interrupted.runtime.status).toBe("awaiting_human_intervention");
    expect(interrupted.runtime.humanDecision).toEqual({ reason: "manual-review" });
    expect(resumed.runtime.k).toBe(1);
    expect(resumed.runtime.simulation).toBe(true);
  });
});
