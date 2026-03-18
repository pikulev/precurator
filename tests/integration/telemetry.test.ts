import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { compileControlSystem } from "../../src";

describe("telemetry events", () => {
  it("emits step:completed with required fields during converge", async () => {
    const completed: Array<Record<string, unknown>> = [];

    const system = compileControlSystem(
      {
        schemas: {
          target: z.object({ value: z.number() }),
          current: z.object({ value: z.number() })
        },
        stopPolicy: {
          epsilon: 0,
          maxIterations: 5
        },
        observerRef: "increment-observer"
      },
      {
        observers: {
          "increment-observer": ({ current, target }) => ({
            value: Math.min(current.value + 5, target.value)
          })
        }
      }
    );

    system.on("step:completed", (payload) => {
      completed.push(payload as unknown as Record<string, unknown>);
    });

    const snapshot = await system.invoke({
      target: { value: 10 },
      current: { value: 0 },
      metadata: { thread_id: "telemetry-complete" }
    });

    expect(snapshot.runtime.status).toBe("converged");
    expect(completed.length).toBeGreaterThan(0);

    for (const payload of completed) {
      expect(typeof payload.control_step_type).toBe("string");
      expect(typeof payload.error_score).toBe("number");
      expect(typeof payload.delta_error).toBe("number");
      expect(typeof payload.error_trend).toBe("string");
      expect(typeof payload.simulation).toBe("boolean");
      expect(typeof payload.checkpoint_id).toBe("string");
      expect(payload.thread_id ?? undefined).toBe("telemetry-complete");
    }

    expect(completed.map((p) => p.control_step_type)).toEqual(
      expect.arrayContaining(["Observation", "Comparison", "Execution"])
    );
  });

  it("emits step:interrupted during HITL interrupt", async () => {
    const interrupted: Array<Record<string, unknown>> = [];

    const verifier = vi.fn().mockResolvedValueOnce({
      status: "awaiting_human_intervention" as const,
      stopReason: "manual-review"
    });

    const system = compileControlSystem<{ value: number }, { value: number }>(
      {
        stopPolicy: {
          epsilon: 0,
          maxIterations: 5
        },
        observerRef: "increment-observer",
        verifierRef: "hitl-verifier"
      },
      {
        observers: {
          "increment-observer": ({ current, target }) => ({
            value: Math.min(current.value + 5, target.value)
          })
        },
        verifiers: {
          "hitl-verifier": verifier
        }
      }
    );

    system.on("step:interrupted", (payload) => {
      interrupted.push(payload as unknown as Record<string, unknown>);
    });

    const snapshot = await system.invoke({
      target: { value: 10 },
      current: { value: 0 },
      simulation: true,
      metadata: { thread_id: "telemetry-interrupt" }
    });

    expect(snapshot.runtime.status).toBe("awaiting_human_intervention");
    expect(interrupted).toHaveLength(1);

    const payload = interrupted[0]!;
    expect(payload.control_step_type).toBe("Execution");
    expect(payload.human_intervention_reason).toBe("manual-review");
    expect(payload.stop_reason).toBe("manual-review");
    expect(payload.simulation).toBe(true);
    expect(typeof payload.checkpoint_id).toBe("string");
    expect(payload.thread_id).toBe("telemetry-interrupt");
  });
});

