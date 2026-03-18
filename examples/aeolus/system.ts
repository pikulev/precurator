import { z } from "zod";

import {
  DefaultSummarizer,
  compileControlSystem,
  type CompiledControlSystem,
  type ComparatorResult,
  type ErrorTrend,
  type RuntimeDiagnostics
} from "../../src";
import type { AeolusReport, AeolusRunReport } from "./report-data";
import { AeolusReportCollector } from "./report-data";
import {
  createInitialCurrent,
  createSeededRng,
  errorScoreForPosition,
  formatDisturbanceDelta,
  formatVector,
  isOutsideField,
  simulateAeolusStep,
  type AeolusCurrent,
  type AeolusTarget,
  type AeolusVector
} from "./domain";

const vectorSchema = z.object({
  x: z.number(),
  y: z.number()
});

const targetSchema = z.object({
  target: vectorSchema,
  fieldMin: z.number(),
  fieldMax: z.number()
});

const currentSchema = z.object({
  position: vectorSchema,
  controlForce: vectorSchema,
  noiseForce: vectorSchema,
  predictedPosition: vectorSchema,
  disturbanceDelta: vectorSchema,
  disturbanceMagnitude: z.number(),
  controllerGain: z.number(),
  controlAuthority: z.number(),
  lastDistanceToTarget: z.number(),
  reasoningTrace: z.string()
});

export interface AeolusDemoOptions {
  seed?: string;
  target?: AeolusTarget;
  initialPosition?: AeolusVector;
  previewThreadId?: string;
  realityThreadId?: string;
  previewNoiseSequence?: AeolusVector[];
  realityNoiseSequence?: AeolusVector[];
}

export interface AeolusDemoResult {
  report: AeolusReport;
  runs: {
    simulation: AeolusRunReport;
    reality: AeolusRunReport;
  };
}

export function defaultAeolusTarget(): AeolusTarget {
  return {
    target: { x: 100, y: 100 },
    fieldMin: 0,
    fieldMax: 100
  };
}

export function createAeolusSystemEnvironment(): {
  collector: AeolusReportCollector;
  system: CompiledControlSystem<AeolusTarget, AeolusCurrent>;
} {
  const collector = new AeolusReportCollector();
  const rngByThread = new Map<string, () => number>();
  const observationCountByThread = new Map<string, number>();
  const compactedCountByThread = new Map<string, number>();

  const system = compileControlSystem<AeolusTarget, AeolusCurrent>(
    {
      schemas: {
        target: targetSchema,
        current: currentSchema
      },
      stopPolicy: {
        epsilon: 0.08,
        maxIterations: 30
      },
      memory: {
        maxShortTermSteps: 4,
        compactionStrategy: "summarize-oldest",
        summaryReplacementSemantics: "replace-compacted-steps"
      },
      mode: "conservative",
      observerRef: "aeolus-observer",
      comparatorRef: "aeolus-comparator",
      verifierRef: "aeolus-verifier"
    },
    {
      observers: {
        "aeolus-observer": ({ current, target, worldContext, metadata, executionContext }) => {
          const threadId = readThreadId(metadata);
          const stepIndex = observationCountByThread.get(threadId) ?? 0;
          const rng = resolveThreadRng(
            rngByThread,
            threadId,
            readSeed(worldContext) ?? `${threadId}-seed`
          );
          const noiseSequence = readNoiseSequence(worldContext);
          const forcedNoise = noiseSequence[stepIndex];
          const { nextCurrent } = simulateAeolusStep({
            target,
            current,
            simulation: executionContext.simulation,
            rng,
            ...(forcedNoise ? { noiseForce: forcedNoise } : {})
          });

          collector.recordObservation({
            threadId,
            k: stepIndex,
            simulation: executionContext.simulation,
            current: nextCurrent
          });
          observationCountByThread.set(threadId, stepIndex + 1);

          return nextCurrent;
        }
      },
      comparators: {
        "aeolus-comparator": ({ target, current, previousErrorScore }) => {
          const errorScore = errorScoreForPosition(current.position, target);
          const deltaError =
            previousErrorScore === undefined
              ? errorScore
              : round(errorScore - previousErrorScore);
          const errorTrend = deriveTrend(deltaError);

          return {
            errorVector: {
              offsetX: round(target.target.x - current.position.x),
              offsetY: round(target.target.y - current.position.y),
              disturbanceMagnitude: current.disturbanceMagnitude
            },
            errorScore,
            deltaError,
            errorTrend,
            prediction: [
              `Predictor expected ${formatVector(current.predictedPosition)}.`,
              `Control vector ${formatVector(current.controlForce)}.`,
              current.disturbanceMagnitude > 0
                ? `Observed disturbance delta ${formatDisturbanceDelta(current.disturbanceDelta)}.`
                : "No external disturbance detected."
            ].join(" ")
          } satisfies ComparatorResult;
        }
      },
      verifiers: {
        "aeolus-verifier": ({ target, current, metadata }) => {
          const threadId = readThreadId(metadata);

          if (isOutsideField(current.position, target)) {
            const diagnostics = createCriticalDriftDiagnostics(target, current);
            collector.recordVerifier({
              threadId,
              diagnosticsCode: diagnostics.code,
              stopReason: `${diagnostics.code}: ${diagnostics.message}`,
              verifierAlert: "Disturbance Detected: Verifier corrective action triggered."
            });

            return {
              status: "awaiting_human_intervention" as const,
              stopReason: `${diagnostics.code}: ${diagnostics.message}`,
              diagnostics
            };
          }

          if (current.disturbanceMagnitude >= 5.6) {
            const diagnostics = {
              code: "DISTURBANCE_DETECTED",
              message: "External disturbance observed. Increase authority conservatively.",
              evidence: {
                predictedPosition: current.predictedPosition,
                actualPosition: current.position,
                disturbanceDelta: current.disturbanceDelta,
                disturbanceMagnitude: current.disturbanceMagnitude,
                controlForce: current.controlForce
              }
            } satisfies RuntimeDiagnostics;

            collector.recordVerifier({
              threadId,
              diagnosticsCode: diagnostics.code,
              verifierAlert: "Disturbance Detected: Verifier corrective action triggered."
            });

            return {
              status: "optimizing" as const,
              diagnostics
            };
          }

          return {
            status: "optimizing" as const
          };
        }
      },
      summarizeCompactedSteps: async ({ compacted, context }) => {
        const summary = await DefaultSummarizer({ compacted, context });
        const threadId = parseThreadIdFromAuditLogRef(context.auditLogRef);
        const previouslyCompacted = compactedCountByThread.get(threadId) ?? 0;
        const nextCompacted = previouslyCompacted + compacted.length;
        compactedCountByThread.set(threadId, nextCompacted);

        collector.queueCompactionToast(
          threadId,
          `Step ${previouslyCompacted + 1}-${nextCompacted} compacted into Summary. Context optimized.`
        );

        return summary;
      }
    }
  );

  system.on("step:completed", (payload) => {
    collector.recordCompletedTelemetry(payload);
  });

  system.on("step:interrupted", (payload) => {
    collector.recordInterruptedTelemetry(payload);
  });

  return {
    collector,
    system
  };
}

export async function runAeolusDemo(options: AeolusDemoOptions = {}): Promise<AeolusDemoResult> {
  const target = options.target ?? defaultAeolusTarget();
  const initialPosition = options.initialPosition ?? { x: 0, y: 0 };
  const previewThreadId = options.previewThreadId ?? "aeolus-preview";
  const realityThreadId = options.realityThreadId ?? "aeolus-reality";
  const seed = options.seed ?? "steady-breeze";
  const { collector, system } = createAeolusSystemEnvironment();

  collector.registerRun({
    threadId: previewThreadId,
    simulation: true,
    previewPath: []
  });

  const simulationSnapshot = await system.invoke({
    target,
    current: createInitialCurrent(initialPosition, target),
    simulation: true,
    metadata: {
      thread_id: previewThreadId
    },
    worldContext: {
      seed,
      ...(options.previewNoiseSequence ? { noiseSequence: options.previewNoiseSequence } : {})
    }
  });

  const simulationReportBase = collector.finalizeRun({
    threadId: previewThreadId,
    finalStatus: simulationSnapshot.runtime.status,
    ...(simulationSnapshot.runtime.stopReason
      ? { finalStopReason: simulationSnapshot.runtime.stopReason }
      : {}),
    ...(simulationSnapshot.runtime.diagnostics?.code
      ? { finalDiagnosticsCode: simulationSnapshot.runtime.diagnostics.code }
      : {})
  });
  const previewPath = simulationReportBase.steps.map((step) => step.actualPosition);
  const simulationReport: AeolusRunReport = {
    ...simulationReportBase,
    previewPath
  };

  collector.registerRun({
    threadId: realityThreadId,
    simulation: false,
    previewPath
  });

  const realitySnapshot = await system.invoke({
    target,
    current: createInitialCurrent(initialPosition, target),
    simulation: false,
    metadata: {
      thread_id: realityThreadId
    },
    worldContext: {
      seed,
      ...(options.realityNoiseSequence ? { noiseSequence: options.realityNoiseSequence } : {})
    }
  });

  const realityReport = collector.finalizeRun({
    threadId: realityThreadId,
    finalStatus: realitySnapshot.runtime.status,
    ...(realitySnapshot.runtime.stopReason
      ? { finalStopReason: realitySnapshot.runtime.stopReason }
      : {}),
    ...(realitySnapshot.runtime.diagnostics?.code
      ? { finalDiagnosticsCode: realitySnapshot.runtime.diagnostics.code }
      : {})
  });

  return {
    report: {
      generatedAt: new Date().toISOString(),
      target,
      runs: {
        simulation: simulationReport,
        reality: realityReport
      },
      notes: [
        "Simulation branch disables the Chaotic Turbine and acts as the ideal preview path.",
        "Reality branch replays the same initial conditions with bounded random disturbance in [-5, +5] per axis.",
        "The controller is tuned for a long horizon of roughly 20-30 real control steps so the dashboard animation reflects actual runtime snapshots.",
        "The dashboard surfaces Disturbance Delta, verifier alerts and compaction toasts without leaking runtime closures into checkpointed state."
      ]
    },
    runs: {
      simulation: simulationReport,
      reality: realityReport
    }
  };
}

function resolveThreadRng(
  registry: Map<string, () => number>,
  threadId: string,
  seed: string
): () => number {
  const existing = registry.get(threadId);
  if (existing) {
    return existing;
  }

  const rng = createSeededRng(seed);
  registry.set(threadId, rng);
  return rng;
}

function deriveTrend(deltaError: number): ErrorTrend {
  if (deltaError <= -0.01) {
    return "improving";
  }

  if (deltaError >= 0.01) {
    return "degrading";
  }

  return "flat";
}

function createCriticalDriftDiagnostics(
  target: AeolusTarget,
  current: AeolusCurrent
): RuntimeDiagnostics {
  return {
    code: "CRITICAL_DRIFT",
    message: "External disturbance exceeds control authority",
    evidence: {
      fieldMin: target.fieldMin,
      fieldMax: target.fieldMax,
      actualPosition: current.position,
      predictedPosition: current.predictedPosition,
      disturbanceDelta: current.disturbanceDelta,
      disturbanceMagnitude: current.disturbanceMagnitude,
      controlForce: current.controlForce,
      controlAuthority: current.controlAuthority
    },
    recommendedAction: "interrupt"
  };
}

function readThreadId(metadata?: Record<string, unknown>): string {
  const threadId = metadata?.thread_id;
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("Aeolus example requires metadata.thread_id.");
  }

  return threadId;
}

function readSeed(worldContext: Record<string, unknown>): string | undefined {
  return typeof worldContext.seed === "string" ? worldContext.seed : undefined;
}

function readNoiseSequence(worldContext: Record<string, unknown>): AeolusVector[] {
  const candidate = worldContext.noiseSequence;
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const x = (entry as { x?: unknown }).x;
    const y = (entry as { y?: unknown }).y;
    return typeof x === "number" && typeof y === "number" ? [{ x, y }] : [];
  });
}

function parseThreadIdFromAuditLogRef(auditLogRef?: string): string {
  if (!auditLogRef) {
    return "default";
  }

  const match = /(?:simulation|runtime)-audit-(.+)$/u.exec(auditLogRef);
  return match?.[1] ?? "default";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
