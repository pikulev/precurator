import type { RunnableConfig } from "@langchain/core/runnables";
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  StateGraph,
  interrupt
} from "@langchain/langgraph";
import { ZodError } from "zod";

import type { ControlState, JsonValue } from "../contracts/state";
import { deterministicComparator } from "../comparator/deterministic";
import {
  compactShortTermMemory,
  createMemoryStep,
  DefaultSummarizer
} from "../memory/compaction";
import type {
  CompiledControlSystem,
  ControlSystemConfig,
  ComparatorHandler,
  EvolveHandler,
  EvolveInput,
  PrecuratorTelemetryEventName,
  PrecuratorTelemetryEventPayloadMap,
  InvokeInput,
  MemoryConfig,
  ResumeInput,
  RuntimeExecutionContext,
  RuntimeRegistry,
  TokenBudgetEstimator,
  TokenBudgetEstimatorInput,
  ToolExecutionContext,
  ToolRegistration,
  VerifierHandler,
  VerifierInput,
  VerifierResult
} from "./config";
import { PrecuratorValidationError, SimulationSecurityError } from "./errors";
import {
  resolveIterationOutcome,
  shouldContinue
} from "./routing";
import { assertJsonReadySerializable } from "./serializability";
import {
  assertComparatorResultShape,
  assertVerifierResultShape
} from "./validators";

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  maxShortTermSteps: 8,
  compactionStrategy: "sliding-window",
  summaryReplacementSemantics: "replace-compacted-steps"
};

function normalizeMetadata(
  configMetadata?: Record<string, JsonValue>,
  inputMetadata?: Record<string, JsonValue>
): Record<string, JsonValue> | undefined {
  if (!configMetadata && !inputMetadata) {
    return undefined;
  }

  return {
    ...(configMetadata ?? {}),
    ...(inputMetadata ?? {})
  };
}

function readTraceId(metadata?: Record<string, JsonValue>): string | undefined {
  const traceCandidate = metadata?.trace_id ?? metadata?.thread_id;
  return typeof traceCandidate === "string" && traceCandidate.length > 0
    ? traceCandidate
    : undefined;
}

function readThreadId(metadata?: Record<string, JsonValue>): string | undefined {
  const threadId = metadata?.thread_id;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : undefined;
}

function createAuditLogRef(
  metadata: Record<string, JsonValue> | undefined,
  simulation: boolean
): string {
  const namespace = simulation ? "simulation" : "runtime";
  const traceId = readTraceId(metadata);
  return traceId ? `${namespace}-audit-${traceId}` : `${namespace}-audit-default`;
}

function createExecutionCheckpointLabel(
  auditLogRef: string | undefined,
  k: number
): string {
  return `${auditLogRef ?? "runtime-audit-default"}:iteration-${k}`;
}

function resolveEvolver<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry<TTarget, TCurrent>
): EvolveHandler<TTarget, TCurrent> | undefined {
  if (!config.evolveRef) {
    return undefined;
  }

  const evolver = registry.evolvers?.[config.evolveRef] as
    | EvolveHandler<TTarget, TCurrent>
    | undefined;
  if (!evolver) {
    throw new Error(`Evolver "${config.evolveRef}" is not registered.`);
  }

  return evolver;
}

function resolveVerifier<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry<TTarget, TCurrent>
): VerifierHandler<TTarget, TCurrent> | undefined {
  if (!config.verifierRef) {
    return undefined;
  }

  const verifier = registry.verifiers?.[config.verifierRef] as
    | VerifierHandler<TTarget, TCurrent>
    | undefined;
  if (!verifier) {
    throw new Error(`Verifier "${config.verifierRef}" is not registered.`);
  }

  return verifier;
}

function resolveComparator<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry<TTarget, TCurrent>
): ComparatorHandler<TTarget, TCurrent> | undefined {
  if (!config.comparatorRef) {
    return undefined;
  }

  const comparator = registry.comparators?.[config.comparatorRef] as
    | ComparatorHandler<TTarget, TCurrent>
    | undefined;
  if (!comparator) {
    throw new Error(`Comparator "${config.comparatorRef}" is not registered.`);
  }

  return comparator;
}

function resolveModel<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry<TTarget, TCurrent>
): unknown {
  if (!config.modelRef) {
    return undefined;
  }

  const model = registry.models?.[config.modelRef];
  if (model === undefined) {
    throw new Error(`Model "${config.modelRef}" is not registered.`);
  }

  return model;
}

function resolveTool<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry<TTarget, TCurrent>,
  toolRef: string
): ToolRegistration {
  if (config.toolRefs && !config.toolRefs.includes(toolRef)) {
    throw new Error(`Tool "${toolRef}" is not enabled by toolRefs.`);
  }

  const tool = registry.tools?.[toolRef];
  if (!tool) {
    throw new Error(`Tool "${toolRef}" is not registered.`);
  }

  return tool;
}

function createToolInvoker<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry<TTarget, TCurrent>,
  context: ToolExecutionContext
): RuntimeExecutionContext["invokeTool"] {
  return async (toolRef, input) => {
    const tool = resolveTool(config, registry, toolRef);
    if (context.simulation && tool.destructive) {
      if (tool.dryRun) {
        return tool.dryRun(
          input === undefined
            ? { executionContext: context }
            : {
                input,
                executionContext: context
              }
        );
      }

      throw new SimulationSecurityError(toolRef);
    }

    return tool.execute(
      input === undefined
        ? { executionContext: context }
        : {
            input,
            executionContext: context
          }
    );
  };
}

function createExecutionContext<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry<TTarget, TCurrent>,
  snapshot: ControlState<TTarget, TCurrent>
): RuntimeExecutionContext {
  const traceId = readTraceId(snapshot.runtime.metadata);
  const checkpointId =
    snapshot.runtime.checkpointId ??
    createExecutionCheckpointLabel(snapshot.runtime.auditLogRef, snapshot.runtime.k);
  const baseContext: ToolExecutionContext = {
    simulation: snapshot.runtime.simulation,
    readOnly: snapshot.runtime.simulation,
    checkpointId,
    ...(traceId ? { traceId } : {}),
    ...(snapshot.runtime.bestCheckpointId
      ? { bestCheckpointId: snapshot.runtime.bestCheckpointId }
      : {}),
    k: snapshot.runtime.k,
    ...(config.modelRef ? { modelRef: config.modelRef } : {}),
    ...(config.modelRef ? { model: resolveModel(config, registry) } : {})
  };

  return {
    ...baseContext,
    invokeTool: createToolInvoker(config, registry, baseContext)
  };
}

function serializeBudgetPart(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function defaultTokenBudgetEstimator<TTarget, TCurrent>(
  input: TokenBudgetEstimatorInput<TTarget, TCurrent>
): number {
  const serialized = [
    input.target,
    input.current,
    input.worldContext,
    input.metadata ?? null,
    input.comparison,
    input.verifierResult ?? null
  ]
    .map(serializeBudgetPart)
    .join("");

  return Math.max(1, Math.ceil(serialized.length / 4));
}

async function estimateTokenBudget<TTarget, TCurrent>(
  registry: RuntimeRegistry<TTarget, TCurrent>,
  input: TokenBudgetEstimatorInput<TTarget, TCurrent>
): Promise<number> {
  const estimator = registry.tokenBudgetEstimator as
    | TokenBudgetEstimator<TTarget, TCurrent>
    | undefined;
  const estimated = estimator
    ? await estimator(input)
    : defaultTokenBudgetEstimator(input);
  const normalized = Math.ceil(Number(estimated));

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error("Token budget estimator must return a finite non-negative number.");
  }

  return normalized;
}

function mergeSummary(existingSummary?: string, nextSummary?: string): string | undefined {
  if (!existingSummary) {
    return nextSummary;
  }

  if (!nextSummary || nextSummary === existingSummary) {
    return existingSummary;
  }

  return `${existingSummary}\n${nextSummary}`;
}

function extractErrorHistory<TTarget, TCurrent>(
  snapshot?: ControlState<TTarget, TCurrent>
): number[] {
  if (!snapshot) {
    return [];
  }

  if (snapshot.runtime.k < 0) {
    return [];
  }

  const scores = snapshot.control.shortTermMemory.steps
    .map((step) => step.errorScore)
    .filter((value): value is number => typeof value === "number");

  if (scores.length === 0 && typeof snapshot.control.errorScore === "number") {
    return [snapshot.control.errorScore];
  }

  return scores;
}

function mergeHumanDecision(
  existing?: Record<string, JsonValue>,
  next?: Record<string, JsonValue>
): Record<string, JsonValue> | undefined {
  if (!existing && !next) {
    return undefined;
  }

  return {
    ...(existing ?? {}),
    ...(next ?? {})
  };
}

function updateSnapshotStatus<TTarget, TCurrent>(
  snapshot: ControlState<TTarget, TCurrent>,
  status: ControlState<TTarget, TCurrent>["runtime"]["status"],
  stopReason: string,
  humanDecision?: Record<string, JsonValue>
): ControlState<TTarget, TCurrent> {
  const auditLogRef =
    snapshot.runtime.auditLogRef ??
    createAuditLogRef(snapshot.runtime.metadata, snapshot.runtime.simulation);
  const mergedHumanDecision = mergeHumanDecision(
    snapshot.runtime.humanDecision,
    humanDecision
  );

  return {
    control: snapshot.control,
    runtime: {
      ...snapshot.runtime,
      status,
      stopReason,
      auditLogRef,
      ...(mergedHumanDecision ? { humanDecision: mergedHumanDecision } : {})
    }
  };
}

function createThreadConfig(
  metadata: Record<string, JsonValue> | undefined,
  simulation: boolean,
  checkpointId?: string,
  recursionLimit?: number
): RunnableConfig {
  const threadId = readThreadId(metadata);
  if (!threadId) {
    throw new Error("A thread_id is required to read checkpointed state.");
  }

  return {
    configurable: {
      thread_id: `${simulation ? "simulation" : "runtime"}:${threadId}`,
      ...(checkpointId ? { checkpoint_id: checkpointId } : {})
    },
    ...(recursionLimit !== undefined ? { recursionLimit } : {})
  };
}

function deriveRecursionLimit(maxIterations: number): number {
  return Math.max(25, maxIterations * 5 + 10);
}

function readCheckpointId(config: RunnableConfig): string | undefined {
  const configurable = config.configurable as
    | { checkpoint_id?: unknown }
    | undefined;
  return typeof configurable?.checkpoint_id === "string"
    ? configurable.checkpoint_id
    : undefined;
}

function createInitialState<TTarget, TCurrent>(input: {
  target: TTarget;
  current: TCurrent;
  worldContext: Record<string, unknown>;
  simulation: boolean;
  metadata?: Record<string, JsonValue>;
  memoryConfig: MemoryConfig;
}): ControlState<TTarget, TCurrent> {
  const auditLogRef = createAuditLogRef(input.metadata, input.simulation);

  return {
    control: {
      target: input.target,
      current: input.current,
      worldContext: input.worldContext,
      errorVector: {},
      errorScore: 1,
      deltaError: 0,
      errorTrend: "flat",
      shortTermMemory: {
        steps: [],
        maxShortTermSteps: input.memoryConfig.maxShortTermSteps,
        compactionStrategy: input.memoryConfig.compactionStrategy,
        summaryReplacementSemantics: input.memoryConfig.summaryReplacementSemantics
      }
    },
    runtime: {
      k: -1,
      status: "optimizing",
      auditLogRef,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      simulation: input.simulation
    }
  };
}

function normalizeResumePayload<TCurrent>(value: unknown): ResumeInput<TCurrent> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as ResumeInput<TCurrent>;
}

function hasPendingInterrupt(snapshot: {
  tasks?: Array<{ interrupts?: unknown[] }>;
}): boolean {
  return (
    snapshot.tasks?.some(
      (task) => Array.isArray(task.interrupts) && task.interrupts.length > 0
    ) ?? false
  );
}

async function loadThreadState<TTarget, TCurrent>(
  graph: CompiledControlSystem<TTarget, TCurrent>["graph"],
  threadConfig: RunnableConfig
): Promise<ControlState<TTarget, TCurrent>> {
  const persisted = await graph.getState(threadConfig);
  const values = persisted.values as ControlState<TTarget, TCurrent>;
  const currentCheckpointId = readCheckpointId(persisted.config);
  let bestCheckpointId = readCheckpointId(persisted.config);
  let bestErrorScore =
    typeof values.control.errorScore === "number"
      ? values.control.errorScore
      : Number.POSITIVE_INFINITY;

  for await (const snapshot of graph.getStateHistory(threadConfig)) {
    const state = snapshot.values as ControlState<TTarget, TCurrent>;
    if (typeof state?.control?.errorScore !== "number") {
      continue;
    }

    if (state.control.errorScore <= bestErrorScore) {
      bestErrorScore = state.control.errorScore;
      bestCheckpointId = readCheckpointId(snapshot.config) ?? bestCheckpointId;
    }
  }

  return {
    ...values,
    runtime: {
      ...values.runtime,
      ...(currentCheckpointId ? { checkpointId: currentCheckpointId } : {}),
      ...(bestCheckpointId ? { bestCheckpointId } : {})
    }
  };
}

export function compileControlSystem<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  runtimeRegistry: RuntimeRegistry<TTarget, TCurrent> = {}
): CompiledControlSystem<TTarget, TCurrent> {
  const evolver = resolveEvolver(config, runtimeRegistry);
  const verifier = resolveVerifier(config, runtimeRegistry);
  const comparator = resolveComparator(config, runtimeRegistry);
  const memoryConfig = {
    ...DEFAULT_MEMORY_CONFIG,
    ...(config.memory ?? {})
  };
  const checkpointer = runtimeRegistry.checkpointer ?? new MemorySaver();
  let generatedThreadSequence = 0;

  const stepCompletedListeners = new Set<
    (payload: PrecuratorTelemetryEventPayloadMap["step:completed"]) => void
  >();
  const stepInterruptedListeners = new Set<
    (payload: PrecuratorTelemetryEventPayloadMap["step:interrupted"]) => void
  >();

  function emitTelemetry<E extends PrecuratorTelemetryEventName>(
    eventName: E,
    payload: PrecuratorTelemetryEventPayloadMap[E]
  ): void {
    if (eventName === "step:completed") {
      for (const listener of stepCompletedListeners) {
        try {
          listener(payload as PrecuratorTelemetryEventPayloadMap["step:completed"]);
        } catch {
          // Telemetry must never break control flow.
        }
      }
      return;
    }

    for (const listener of stepInterruptedListeners) {
      try {
        listener(payload as PrecuratorTelemetryEventPayloadMap["step:interrupted"]);
      } catch {
        // Telemetry must never break control flow.
      }
    }
  }

  function onTelemetry<E extends PrecuratorTelemetryEventName>(
    eventName: E,
    listener: (payload: PrecuratorTelemetryEventPayloadMap[E]) => void
  ): void {
    if (eventName === "step:completed") {
      stepCompletedListeners.add(
        listener as (payload: PrecuratorTelemetryEventPayloadMap["step:completed"]) => void
      );
      return;
    }

    stepInterruptedListeners.add(
      listener as (payload: PrecuratorTelemetryEventPayloadMap["step:interrupted"]) => void
    );
  }

  function getCheckpointId(
    snapshot: ControlState<TTarget, TCurrent>,
    kOverride?: number
  ): string {
    const k = kOverride ?? snapshot.runtime.k;
    return snapshot.runtime.checkpointId ??
      createExecutionCheckpointLabel(snapshot.runtime.auditLogRef, k);
  }

  function ensureThreadMetadata(
    metadata: Record<string, JsonValue> | undefined,
    simulation: boolean
  ): Record<string, JsonValue> {
    const existingThreadId = readThreadId(metadata);
    if (existingThreadId) {
      return metadata ?? { thread_id: existingThreadId };
    }

    generatedThreadSequence += 1;
    return {
      ...(metadata ?? {}),
      thread_id: `${simulation ? "simulation" : "runtime"}-thread-${generatedThreadSequence}`
    };
  }

  const StateAnnotation = Annotation.Root({
    control: Annotation<ControlState<TTarget, TCurrent>["control"]>(),
    runtime: Annotation<ControlState<TTarget, TCurrent>["runtime"]>()
  });

  const graph = new StateGraph(StateAnnotation)
    .addNode("evolve", async (state: ControlState<TTarget, TCurrent>) => {
      if (!evolver) {
        return {};
      }

      const executionContext = createExecutionContext(config, runtimeRegistry, state);
      const evolvedCurrent = await evolver({
        target: state.control.target,
        current: state.control.current,
        worldContext: state.control.worldContext,
        ...(state.runtime.metadata ? { metadata: state.runtime.metadata } : {}),
        executionContext
      } satisfies EvolveInput<TTarget, TCurrent>);

      assertJsonReadySerializable(evolvedCurrent, "evolve.current");
      const threadId = readThreadId(state.runtime.metadata);

      // "Тихая" деградация: если эволвер вернул данные, не проходящие схему,
      // мы фиксируем fault и завершаем цикл, не обновляя control.current.
      if (config.schemas?.current) {
        const parsed = config.schemas.current.safeParse(evolvedCurrent);
        if (!parsed.success) {
          return {
            runtime: {
              ...state.runtime,
              status: "failed",
              stopReason: "unrecoverable_schema_violation",
              diagnostics: {
                code: "EVOLVE_SCHEMA_VIOLATION",
                message: parsed.error.message,
                evidence: {
                  rawOutput: evolvedCurrent
                }
              }
            }
          };
        }

        assertJsonReadySerializable(parsed.data, "evolve.current.parsed");

        emitTelemetry("step:completed", {
          control_step_type: "Evolution",
          error_score: state.control.errorScore,
          delta_error: state.control.deltaError,
          error_trend: state.control.errorTrend,
          simulation: state.runtime.simulation,
          checkpoint_id: getCheckpointId(state),
          ...(threadId ? { thread_id: threadId } : {})
        });

        return {
          control: {
            ...state.control,
            current: parsed.data
          }
        };
      }

      emitTelemetry("step:completed", {
        control_step_type: "Evolution",
        error_score: state.control.errorScore,
        delta_error: state.control.deltaError,
        error_trend: state.control.errorTrend,
        simulation: state.runtime.simulation,
        checkpoint_id: getCheckpointId(state),
        ...(threadId ? { thread_id: threadId } : {})
      });

      return {
        control: {
          ...state.control,
          current: evolvedCurrent
        }
      };
    })
    .addNode("compare", async (state: ControlState<TTarget, TCurrent>) => {
      const previousErrorHistory = extractErrorHistory(state);
      const previousErrorScore = previousErrorHistory[previousErrorHistory.length - 1];
      const comparison = comparator
        ? await comparator({
            target: state.control.target,
            current: state.control.current,
            ...(previousErrorScore === undefined ? {} : { previousErrorScore })
          })
        : deterministicComparator<TTarget, TCurrent>({
            target: state.control.target,
            current: state.control.current,
            ...(previousErrorScore === undefined ? {} : { previousErrorScore }),
            errorHistory: previousErrorHistory.slice(0, -1)
          });

      assertComparatorResultShape(comparison, "comparison.result");

      const threadId = readThreadId(state.runtime.metadata);
      emitTelemetry("step:completed", {
        control_step_type: "Comparison",
        error_score: comparison.errorScore,
        delta_error: comparison.deltaError,
        error_trend: comparison.errorTrend,
        simulation: state.runtime.simulation,
        checkpoint_id: getCheckpointId(state, state.runtime.k + 1),
        ...(threadId ? { thread_id: threadId } : {})
      });

      return {
        control: {
          ...state.control,
          errorVector: comparison.errorVector,
          errorScore: comparison.errorScore,
          deltaError: comparison.deltaError,
          errorTrend: comparison.errorTrend,
          ...(comparison.prediction ? { prediction: comparison.prediction } : {})
        },
        runtime: {
          ...state.runtime,
          k: state.runtime.k + 1
        }
      };
    })
    .addNode("verify", async (state: ControlState<TTarget, TCurrent>) => {
      const executionContext = createExecutionContext(config, runtimeRegistry, state);
      const previousErrorHistory = extractErrorHistory(state);
      const nextErrorHistory = [...previousErrorHistory, state.control.errorScore];
      const verifierResult = verifier
        ? await verifier({
            target: state.control.target,
            current: state.control.current,
            worldContext: state.control.worldContext,
            ...(state.runtime.metadata ? { metadata: state.runtime.metadata } : {}),
            comparison: {
              errorVector: state.control.errorVector,
              errorScore: state.control.errorScore,
              deltaError: state.control.deltaError,
              errorTrend: state.control.errorTrend,
              ...(state.control.prediction
                ? { prediction: state.control.prediction }
                : {})
            },
            history: nextErrorHistory,
            executionContext
          } satisfies VerifierInput<TTarget, TCurrent>)
        : undefined;

      assertVerifierResultShape(verifierResult, "verifier.result");

      const iterationTokenBudget =
        config.stopPolicy.maxTokenBudget === undefined
          ? 0
          : await estimateTokenBudget(runtimeRegistry, {
              target: state.control.target,
              current: state.control.current,
              worldContext: state.control.worldContext,
              ...(state.runtime.metadata ? { metadata: state.runtime.metadata } : {}),
              comparison: {
                errorVector: state.control.errorVector,
                errorScore: state.control.errorScore,
                deltaError: state.control.deltaError,
                errorTrend: state.control.errorTrend,
                ...(state.control.prediction
                  ? { prediction: state.control.prediction }
                  : {})
              },
              ...(verifierResult ? { verifierResult } : {}),
              executionContext
            });
      const nextTokenBudgetUsed =
        (state.runtime.tokenBudgetUsed ?? 0) + iterationTokenBudget;
      const outcome = resolveIterationOutcome({
        errorScore: state.control.errorScore,
        epsilon: config.stopPolicy.epsilon,
        errorTrend: state.control.errorTrend,
        iteration: state.runtime.k,
        maxIterations: config.stopPolicy.maxIterations,
        errorHistory: nextErrorHistory,
        ...(verifierResult ? { verifierResult } : {}),
        ...(config.stopPolicy.maxTokenBudget !== undefined
          ? {
              tokenBudget: {
                maxTokenBudget: config.stopPolicy.maxTokenBudget,
                nextTokenBudgetUsed
              }
            }
          : {})
      });

      const threadId = readThreadId(state.runtime.metadata);
      emitTelemetry("step:completed", {
        control_step_type: "Execution",
        error_score: state.control.errorScore,
        delta_error: state.control.deltaError,
        error_trend: state.control.errorTrend,
        simulation: state.runtime.simulation,
        checkpoint_id: getCheckpointId(state),
        ...(threadId ? { thread_id: threadId } : {})
      });

      const {
        diagnostics: _previousDiagnostics,
        stopReason: _previousStopReason,
        ...runtimeWithoutTransientOutcome
      } = state.runtime;

      return {
        runtime: {
          ...runtimeWithoutTransientOutcome,
          status: outcome.status,
          ...(outcome.stopReason !== undefined ? { stopReason: outcome.stopReason } : {}),
          ...(outcome.diagnostics !== undefined ? { diagnostics: outcome.diagnostics } : {}),
          ...(config.stopPolicy.maxTokenBudget !== undefined
            ? { tokenBudgetUsed: nextTokenBudgetUsed }
            : {})
        }
      };
    })
    .addNode("compactMemory", async (state: ControlState<TTarget, TCurrent>) => {
      const memoryHistory = [
        ...state.control.shortTermMemory.steps,
        createMemoryStep({
          kind: "comparison",
          message:
            state.runtime.status === "converged"
              ? "Converged."
              : state.runtime.status === "optimizing"
                ? "Iteration continuing."
                : `Stopped: ${state.runtime.stopReason ?? state.runtime.status}.`,
          errorScore: state.control.errorScore,
          ...(state.runtime.metadata ? { metadata: state.runtime.metadata } : {})
        })
      ];
      const compactedMemory = await compactShortTermMemory(
        memoryHistory,
        {
          maxShortTermSteps: memoryConfig.maxShortTermSteps,
          strategy: memoryConfig.compactionStrategy,
          semantics: memoryConfig.summaryReplacementSemantics,
          ...(state.runtime.auditLogRef
            ? { auditLogRef: state.runtime.auditLogRef }
            : {})
        },
        runtimeRegistry.summarizeCompactedSteps ?? DefaultSummarizer
      );
      const summary = mergeSummary(
        state.control.shortTermMemory.summary,
        compactedMemory.summary
      );

      return {
        control: {
          ...state.control,
          shortTermMemory: {
            ...compactedMemory,
            ...(summary ? { summary } : {})
          }
        }
      };
    })
    .addNode("interrupt", (state: ControlState<TTarget, TCurrent>) => {
      const resumePayload = interrupt<{
        checkpointId?: string;
        k: number;
        status: string;
        stopReason?: string;
      }, ResumeInput<TCurrent>>({
        k: state.runtime.k,
        status: state.runtime.status,
        ...(state.runtime.checkpointId
          ? { checkpointId: state.runtime.checkpointId }
          : {}),
        ...(state.runtime.stopReason ? { stopReason: state.runtime.stopReason } : {})
      });
      const normalizedResume = normalizeResumePayload<TCurrent>(resumePayload);
      const nextCurrent = (() => {
        if (normalizedResume.current === undefined) {
          return state.control.current;
        }

        try {
          return config.schemas?.current
            ? config.schemas.current.parse(normalizedResume.current)
            : normalizedResume.current;
        } catch (err) {
          if (err instanceof ZodError) {
            throw new PrecuratorValidationError(
              "Invalid `current` provided during resume/interrupt.",
              err.issues
            );
          }

          throw err;
        }
      })();

      assertJsonReadySerializable(nextCurrent, "interrupt.current");

      const humanDecision = mergeHumanDecision(
        state.runtime.humanDecision,
        normalizedResume.humanDecision
      );

      if (humanDecision) {
        assertJsonReadySerializable(humanDecision, "interrupt.humanDecision");
      }

      if (normalizedResume.humanDecision?.action === "abort") {
        return {
          control: {
            ...state.control,
            current: nextCurrent
          },
          runtime: {
            ...state.runtime,
            status: "aborted",
            stopReason: "abort",
            ...(humanDecision ? { humanDecision } : {})
          }
        };
      }

      return {
        control: {
          ...state.control,
          current: nextCurrent
        },
        runtime: {
          ...state.runtime,
          status: "optimizing",
          ...(humanDecision ? { humanDecision } : {})
        }
      };
    })
    .addEdge("__start__", "evolve")
    .addConditionalEdges(
      "evolve",
      (state: ControlState<TTarget, TCurrent>) =>
        state.runtime.status === "optimizing" ? "compare" : END
    )
    .addEdge("compare", "verify")
    .addEdge("verify", "compactMemory")
    .addConditionalEdges("compactMemory", (state: ControlState<TTarget, TCurrent>) => {
      const route = shouldContinue({
        status: state.runtime.status,
        errorScore: state.control.errorScore,
        epsilon: config.stopPolicy.epsilon
      });

      if (route === "interrupt") {
        const threadId = readThreadId(state.runtime.metadata);
        const stopReason = state.runtime.stopReason;
        emitTelemetry("step:interrupted", {
          control_step_type: "Execution",
          error_score: state.control.errorScore,
          delta_error: state.control.deltaError,
          error_trend: state.control.errorTrend,
          simulation: state.runtime.simulation,
          checkpoint_id: getCheckpointId(state),
          ...(threadId ? { thread_id: threadId } : {}),
          ...(stopReason !== undefined
            ? {
                human_intervention_reason: stopReason,
                stop_reason: stopReason
              }
            : {})
        });
      }

      return route;
    })
    .addConditionalEdges("interrupt", (state: ControlState<TTarget, TCurrent>) =>
      state.runtime.status === "aborted" ? END : "evolve"
    )
    .compile({
      checkpointer,
      name: "precurator-control-system",
      description: "Cybernetic control loop compiled to a LangGraph StateGraph."
    });

  async function persistPatchedState(
    snapshot: ControlState<TTarget, TCurrent>
  ): Promise<ControlState<TTarget, TCurrent>> {
    const threadConfig = createThreadConfig(
      snapshot.runtime.metadata,
      snapshot.runtime.simulation
    );
    await graph.updateState(threadConfig, snapshot, "interrupt");
    return loadThreadState(graph, threadConfig);
  }

  return {
    config,
    graph,
    on: onTelemetry,
    getThreadConfig(input) {
      return createThreadConfig(
        { thread_id: input.threadId },
        input.simulation ?? false,
        input.checkpointId
      );
    },
    async getState(input) {
      return loadThreadState(
        graph,
        createThreadConfig(
          { thread_id: input.threadId },
          input.simulation ?? false,
          input.checkpointId
        )
      );
    },
    async invoke(input) {
      const simulation = input.simulation ?? false;
      const metadata = ensureThreadMetadata(
        normalizeMetadata(config.metadata, input.metadata),
        simulation
      );

      assertJsonReadySerializable(metadata, "invoke.metadata");

      const validatedTarget = (() => {
        if (!config.schemas?.target) {
          return input.target;
        }

        try {
          return config.schemas.target.parse(input.target);
        } catch (err) {
          if (err instanceof ZodError) {
            throw new PrecuratorValidationError(
              "Invalid `target` provided to invoke().",
              err.issues
            );
          }
          throw err;
        }
      })();

      assertJsonReadySerializable(validatedTarget, "invoke.target");

      const validatedCurrent = (() => {
        if (!config.schemas?.current) {
          return input.current;
        }

        try {
          return config.schemas.current.parse(input.current);
        } catch (err) {
          if (err instanceof ZodError) {
            throw new PrecuratorValidationError(
              "Invalid `current` provided to invoke().",
              err.issues
            );
          }
          throw err;
        }
      })();

      assertJsonReadySerializable(validatedCurrent, "invoke.current");

      const worldContext = input.worldContext ?? {};
      assertJsonReadySerializable(worldContext, "invoke.worldContext");

      const initialState = createInitialState({
        target: validatedTarget,
        current: validatedCurrent,
        worldContext,
        simulation,
        metadata,
        memoryConfig
      });
      const threadConfig = createThreadConfig(
        metadata,
        simulation,
        undefined,
        deriveRecursionLimit(config.stopPolicy.maxIterations)
      );

      await graph.invoke(initialState, threadConfig);
      return loadThreadState(graph, threadConfig);
    },
    async interrupt(snapshot, humanDecision) {
      if (humanDecision) {
        assertJsonReadySerializable(humanDecision, "interrupt.humanDecision");
      }
      const interruptedSnapshot = updateSnapshotStatus(
        snapshot,
        "awaiting_human_intervention",
        "interrupt",
        humanDecision
      );

      try {
        return await persistPatchedState(interruptedSnapshot);
      } catch {
        return interruptedSnapshot;
      }
    },
    async resume(snapshot, input: ResumeInput<TCurrent> = {}) {
      if (input.humanDecision?.action === "abort") {
        return this.abort(snapshot, input.humanDecision);
      }

      const metadata = ensureThreadMetadata(
        snapshot.runtime.metadata,
        snapshot.runtime.simulation
      );
      const threadConfig = createThreadConfig(
        metadata,
        snapshot.runtime.simulation,
        undefined,
        deriveRecursionLimit(config.stopPolicy.maxIterations)
      );
      const persistedState = await graph.getState(threadConfig).catch(() => undefined);

      if (persistedState && hasPendingInterrupt(persistedState)) {
        await graph.invoke(new Command({ resume: input }), threadConfig);
        return loadThreadState(graph, threadConfig);
      }

      const mergedHumanDecision = mergeHumanDecision(
        snapshot.runtime.humanDecision,
        input.humanDecision
      );

      if (mergedHumanDecision) {
        assertJsonReadySerializable(
          mergedHumanDecision,
          "resume.humanDecision"
        );
      }

      const resumedSnapshot: ControlState<TTarget, TCurrent> = {
        control: {
          ...snapshot.control,
          current:
            input.current !== undefined
              ? (() => {
                  try {
                    if (config.schemas?.current) {
                      const parsed = config.schemas.current.parse(input.current);
                      assertJsonReadySerializable(parsed, "resume.current");
                      return parsed;
                    }

                    assertJsonReadySerializable(input.current, "resume.current");
                    return input.current;
                  } catch (err) {
                    if (err instanceof ZodError) {
                      throw new PrecuratorValidationError(
                        "Invalid `current` provided to resume().",
                        err.issues
                      );
                    }

                    throw err;
                  }
                })()
              : snapshot.control.current
        },
        runtime: {
          ...snapshot.runtime,
          status: "optimizing",
          ...(mergedHumanDecision ? { humanDecision: mergedHumanDecision } : {})
        }
      };

      await graph.invoke(resumedSnapshot, threadConfig);
      return loadThreadState(graph, threadConfig);
    },
    async abort(snapshot, humanDecision) {
      if (humanDecision) {
        assertJsonReadySerializable(humanDecision, "abort.humanDecision");
      }
      const abortedSnapshot = updateSnapshotStatus(
        snapshot,
        "aborted",
        "abort",
        humanDecision
      );

      try {
        return await persistPatchedState(abortedSnapshot);
      } catch {
        return abortedSnapshot;
      }
    }
  };
}
