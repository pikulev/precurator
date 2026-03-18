import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  NonSerializableDataError,
  PrecuratorValidationError,
  SimulationSecurityError,
  compileControlSystem,
  deriveErrorTrend
} from "../../src";
import { toBeSerializable } from "../helpers/assertions";

describe("compileControlSystem", () => {
  it("iterates with an observer until epsilon is reached", async () => {
    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 5
      },
      observerRef: "increment-observer"
    }, {
      observers: {
        "increment-observer": ({ current, target }) => ({
          value: Math.min(current.value + 4, target.value)
        })
      }
    });

    const snapshot = await system.invoke({
      target: { value: 10 },
      current: { value: 0 }
    });

    expect(snapshot.runtime.status).toBe("converged");
    expect(snapshot.runtime.stopReason).toBe("epsilon-reached");
    expect(snapshot.runtime.k).toBe(2);
    expect(snapshot.control.current).toEqual({ value: 10 });
    expect(snapshot.control.shortTermMemory.steps).toHaveLength(3);
  });

  it("stops with failed status when maxIterations is reached", async () => {
    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 2
      }
    });

    const snapshot = await system.invoke({
      target: { value: 10 },
      current: { value: 0 }
    });

    expect(snapshot.runtime.status).toBe("failed");
    expect(snapshot.runtime.stopReason).toBe("max-iterations-reached");
    expect(snapshot.runtime.k).toBe(1);
  });

  it("fails fast on invalid invoke input (schemas.target)", async () => {
    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 2
      }
    });

    await expect(
      system.invoke({
        target: { value: "not-a-number" } as any,
        current: { value: 0 }
      })
    ).rejects.toBeInstanceOf(PrecuratorValidationError);
  });

  it("marks observer schema violations as failed without throwing", async () => {
    const validCurrent = { value: 1 };

    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 3
      },
      observerRef: "bad-observer"
    }, {
      observers: {
        // Intentionally returns invalid shape to assert runtime schema violation behavior.
        "bad-observer": () => ({
          value: "not-a-number",
          leaked: { reason: "sensor-broke" }
        }) as any
      }
    });

    const snapshot = await system.invoke({
      target: { value: 2 },
      current: validCurrent
    });

    expect(snapshot.runtime.status).toBe("failed");
    expect(snapshot.runtime.stopReason).toBe("unrecoverable_schema_violation");
    expect(snapshot.runtime.diagnostics?.code).toBe(
      "OBSERVATION_SCHEMA_VIOLATION"
    );
    expect(snapshot.runtime.diagnostics?.evidence).toMatchObject({
      rawOutput: {
        value: "not-a-number",
        leaked: { reason: "sensor-broke" }
      }
    });
    expect(snapshot.control.current).toEqual(validCurrent);
  });

  it("strips unknown keys from observer output based on schemas.current", async () => {
    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 1
      },
      observerRef: "strip-observer"
    }, {
      observers: {
        "strip-observer": () => ({
          value: 1,
          extra: "should-not-leak"
        })
      }
    });

    const snapshot = await system.invoke({
      target: { value: 1 },
      current: { value: 0 }
    });

    expect(snapshot.runtime.status).toBe("converged");
    expect(snapshot.control.current).toEqual({ value: 1 });
    expect((snapshot.control.current as any).extra).toBeUndefined();
  });

  it("throws NonSerializableDataError when observer returns non-serializable current", async () => {
    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 1
      },
      observerRef: "non-serializable-observer"
    }, {
      observers: {
        "non-serializable-observer": () => ({
          value: new Date()
        } as any)
      }
    });

    await expect(
      system.invoke({
        target: { value: 1 },
        current: { value: 0 }
      })
    ).rejects.toBeInstanceOf(NonSerializableDataError);
  });

  it("marks oscillating trajectories as stuck", async () => {
    const sequence = [0.1, 0.8, 0.1, 0.8];
    let index = 0;
    const system = compileControlSystem<
      { ignored: boolean },
      { history: number[]; errorScore: number }
    >({
      stopPolicy: {
        epsilon: 0.05,
        maxIterations: 5
      },
      observerRef: "oscillating-observer",
      comparatorRef: "oscillating-comparator"
    }, {
      observers: {
        "oscillating-observer": ({ current }) => {
          const nextErrorScore = sequence[index] ?? current.errorScore;
          index += 1;
          return {
            history: [...current.history, nextErrorScore],
            errorScore: nextErrorScore
          };
        }
      },
      comparators: {
        "oscillating-comparator": ({ current, previousErrorScore }) => {
          return {
            errorVector: { score: current.errorScore },
            errorScore: current.errorScore,
            deltaError:
              previousErrorScore === undefined
                ? current.errorScore
                : Number((current.errorScore - previousErrorScore).toFixed(6)),
            errorTrend: deriveErrorTrend(current.history)
          };
        }
      }
    });

    const snapshot = await system.invoke({
      target: { ignored: true },
      current: {
        history: [] as number[],
        errorScore: 0.1
      }
    });

    expect(snapshot.runtime.status).toBe("stuck");
    expect(snapshot.runtime.stopReason).toBe("oscillation-detected");
    expect(snapshot.runtime.diagnostics?.code).toBe("oscillation-detected");
  });

  it("binds JSON-ready refs through the runtime registry without leaking instances into state", async () => {
    const modelInstance = { id: "demo-model" };
    const toolSpy = vi.fn(async () => ({ acknowledged: true }));
    const verifierSpy = vi.fn(async ({ executionContext }) => {
      const toolResult = await executionContext.invokeTool("audit-tool", {
        operation: "inspect"
      });

      expect(executionContext.model).toBe(modelInstance);
      expect(toolResult).toEqual({ acknowledged: true });

      return {
        status: "converged" as const,
        stopReason: "verifier-approved"
      };
    });
    const config = {
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 3
      },
      modelRef: "primary-model",
      observerRef: "read-observer",
      verifierRef: "audit-verifier",
      toolRefs: ["audit-tool"]
    };
    const serializableConfig = {
      stopPolicy: config.stopPolicy,
      modelRef: config.modelRef,
      observerRef: config.observerRef,
      verifierRef: config.verifierRef,
      toolRefs: config.toolRefs
    };
    const system = compileControlSystem(config, {
      models: {
        "primary-model": modelInstance
      },
      observers: {
        "read-observer": ({ current }) => current
      },
      verifiers: {
        "audit-verifier": verifierSpy
      },
      tools: {
        "audit-tool": {
          execute: toolSpy
        }
      }
    });

    const snapshot = await system.invoke({
      target: { value: 1 },
      current: { value: 1 },
      metadata: {
        thread_id: "registry-binding"
      }
    });

    expect(JSON.parse(JSON.stringify(serializableConfig))).toEqual({
      stopPolicy: {
        epsilon: 0,
        maxIterations: 3
      },
      modelRef: "primary-model",
      observerRef: "read-observer",
      verifierRef: "audit-verifier",
      toolRefs: ["audit-tool"]
    });
    expect(verifierSpy).toHaveBeenCalledTimes(1);
    expect(toolSpy).toHaveBeenCalledTimes(1);
    expect(toBeSerializable(snapshot)).toBe(true);
    expect(snapshot.runtime.status).toBe("converged");
    expect(snapshot.runtime.stopReason).toBe("verifier-approved");
  });

  it("uses the external summarizer and keeps auditLogRef stable during compaction", async () => {
    const summarizeCompactedSteps = vi.fn(async ({ compacted, context }) => {
      return `summary:${compacted
        .map((step: { message: string }) => step.message)
        .join(",")}:${context.auditLogRef}`;
    });
    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 5
      },
      comparatorRef: "abs-diff-comparator",
      memory: {
        maxShortTermSteps: 2,
        compactionStrategy: "summarize-oldest",
        summaryReplacementSemantics: "replace-compacted-steps"
      },
      observerRef: "increment-observer"
    }, {
      observers: {
        "increment-observer": ({ current, target }) => ({
          value: Math.min(current.value + 1, target.value)
        })
      },
      comparators: {
        "abs-diff-comparator": ({ target, current, previousErrorScore }) => {
          const errorScore = Number((Math.abs(target.value - current.value) / target.value).toFixed(6));
          return {
            errorVector: {
              value: errorScore
            },
            errorScore,
            deltaError:
              previousErrorScore === undefined
                ? errorScore
                : Number((errorScore - previousErrorScore).toFixed(6)),
            errorTrend: deriveErrorTrend([
              ...(previousErrorScore === undefined ? [] : [previousErrorScore]),
              errorScore
            ])
          };
        }
      },
      summarizeCompactedSteps
    });

    const snapshot = await system.invoke({
      target: { value: 4 },
      current: { value: 0 },
      metadata: {
        thread_id: "memory-loop"
      }
    });

    expect(snapshot.runtime.status).toBe("converged");
    expect(snapshot.runtime.auditLogRef).toBe("runtime-audit-memory-loop");
    expect(snapshot.control.shortTermMemory.steps).toHaveLength(2);
    expect(snapshot.control.shortTermMemory.summary).toContain("runtime-audit-memory-loop");
    expect(summarizeCompactedSteps).toHaveBeenCalled();
  });

  it("blocks destructive tools in simulation and aligns execution context flags", async () => {
    let observedSimulationFlag: boolean | undefined;
    const system = compileControlSystem({
      stopPolicy: {
        epsilon: 0,
        maxIterations: 2
      },
      observerRef: "tool-observer",
      toolRefs: ["destroy-world"]
    }, {
      observers: {
        "tool-observer": async ({ current, executionContext }) => {
          observedSimulationFlag = executionContext.simulation;
          await executionContext.invokeTool("destroy-world", {
            id: "prod-cluster"
          });
          return current;
        }
      },
      tools: {
        "destroy-world": {
          destructive: true,
          execute: async () => ({ ok: true })
        }
      }
    });

    await expect(
      system.invoke({
        target: { value: 1 },
        current: { value: 0 },
        simulation: true,
        metadata: {
          thread_id: "sim-branch"
        }
      })
    ).rejects.toBeInstanceOf(SimulationSecurityError);

    expect(observedSimulationFlag).toBe(true);
  });

  it("supports interrupt, resume and abort with checkpoint semantics", async () => {
    const checkpointer = new MemorySaver();
    const verifier = vi
      .fn()
      .mockResolvedValueOnce({
        status: "awaiting_human_intervention" as const,
        stopReason: "manual-review"
      })
      .mockResolvedValueOnce({
        status: "optimizing" as const
      });
    const system = compileControlSystem<{ value: number }, { value: number }>({
      stopPolicy: {
        epsilon: 0,
        maxIterations: 5
      },
      observerRef: "increment-observer",
      verifierRef: "hitl-verifier"
    }, {
      checkpointer,
      observers: {
        "increment-observer": ({ current, target }) => ({
          value: Math.min(current.value + 5, target.value)
        })
      },
      verifiers: {
        "hitl-verifier": verifier
      }
    });

    const interrupted = await system.invoke({
      target: { value: 10 },
      current: { value: 0 },
      simulation: true,
      metadata: {
        thread_id: "hitl"
      }
    });
    const persisted = await system.graph.getState(
      system.getThreadConfig({
        threadId: "hitl",
        simulation: true
      })
    );
    const checkpointState = await system.graph.getState(
      system.getThreadConfig(
        interrupted.runtime.checkpointId
          ? {
              threadId: "hitl",
              simulation: true,
              checkpointId: interrupted.runtime.checkpointId
            }
          : {
              threadId: "hitl",
              simulation: true
            }
      )
    );
    const resumed = await system.resume(interrupted, {
      current: { value: 10 },
      humanDecision: {
        action: "resume"
      }
    });
    const aborted = await system.abort(interrupted, {
      action: "abort"
    });

    expect(interrupted.runtime.status).toBe("awaiting_human_intervention");
    expect(interrupted.runtime.stopReason).toBe("manual-review");
    expect(interrupted.runtime.checkpointId).toBeTruthy();
    expect((persisted.values as { runtime: { status: string } }).runtime.status).toBe(
      "awaiting_human_intervention"
    );
    expect(
      (
        checkpointState.config.configurable as {
          checkpoint_id?: string;
        }
      ).checkpoint_id
    ).toBe(interrupted.runtime.checkpointId);
    expect(resumed.runtime.k).toBeGreaterThan(interrupted.runtime.k);
    expect(resumed.runtime.simulation).toBe(true);
    expect(resumed.runtime.bestCheckpointId).toBeTruthy();
    expect(aborted.runtime.status).toBe("aborted");
    expect(aborted.runtime.stopReason).toBe("abort");
    expect(aborted.runtime.checkpointId).toBeTruthy();
  });

  it("fails when cumulative token budget exceeds maxTokenBudget", async () => {
    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 5,
        maxTokenBudget: 5
      },
      observerRef: "increment-observer"
    }, {
      observers: {
        "increment-observer": ({ current, target }) => ({
          value: Math.min(current.value + 1, target.value)
        })
      },
      tokenBudgetEstimator: () => 3
    });

    const snapshot = await system.invoke({
      target: { value: 10 },
      current: { value: 0 },
      metadata: {
        thread_id: "token-budget-fail"
      }
    });

    expect(snapshot.runtime.status).toBe("failed");
    expect(snapshot.runtime.stopReason).toBe("max-token-budget-reached");
    expect(snapshot.runtime.k).toBe(1);
    expect(snapshot.runtime.tokenBudgetUsed).toBe(6);
    expect(snapshot.runtime.diagnostics).toEqual({
      code: "max-token-budget-reached",
      message: "Token budget exhausted.",
      evidence: {
        maxTokenBudget: 5,
        tokenBudgetUsed: 6
      }
    });
    expect(toBeSerializable(snapshot)).toBe(true);
  });

  it("treats maxTokenBudget as an inclusive boundary", async () => {
    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 5,
        maxTokenBudget: 6
      },
      observerRef: "increment-observer"
    }, {
      observers: {
        "increment-observer": ({ current, target }) => ({
          value: Math.min(current.value + 1, target.value)
        })
      },
      tokenBudgetEstimator: () => 3
    });

    const snapshot = await system.invoke({
      target: { value: 2 },
      current: { value: 0 },
      simulation: true,
      metadata: {
        thread_id: "token-budget-boundary"
      }
    });

    expect(snapshot.runtime.status).toBe("converged");
    expect(snapshot.runtime.stopReason).toBe("epsilon-reached");
    expect(snapshot.runtime.tokenBudgetUsed).toBe(6);
    expect(snapshot.runtime.simulation).toBe(true);
    expect(toBeSerializable(snapshot)).toBe(true);
  });

  it("preserves consumed token budget across interrupt and resume", async () => {
    const verifier = vi
      .fn()
      .mockResolvedValueOnce({
        status: "awaiting_human_intervention" as const,
        stopReason: "manual-review"
      })
      .mockResolvedValueOnce({
        status: "optimizing" as const
      });
    const system = compileControlSystem({
      schemas: {
        target: z.object({ value: z.number() }),
        current: z.object({ value: z.number() })
      },
      stopPolicy: {
        epsilon: 0,
        maxIterations: 5,
        maxTokenBudget: 5
      },
      observerRef: "increment-observer",
      verifierRef: "hitl-verifier"
    }, {
      observers: {
        "increment-observer": ({ current, target }) => ({
          value: Math.min(current.value + 1, target.value)
        })
      },
      verifiers: {
        "hitl-verifier": verifier
      },
      tokenBudgetEstimator: () => 3
    });

    const interrupted = await system.invoke({
      target: { value: 10 },
      current: { value: 0 },
      metadata: {
        thread_id: "token-budget-resume"
      }
    });
    const resumed = await system.resume(interrupted, {
      humanDecision: {
        action: "resume"
      }
    });

    expect(interrupted.runtime.status).toBe("awaiting_human_intervention");
    expect(interrupted.runtime.tokenBudgetUsed).toBe(3);
    expect(resumed.runtime.status).toBe("failed");
    expect(resumed.runtime.stopReason).toBe("max-token-budget-reached");
    expect(resumed.runtime.k).toBe(1);
    expect(resumed.runtime.tokenBudgetUsed).toBe(6);
    expect(toBeSerializable(resumed)).toBe(true);
  });
});
