import type { ControlState, JsonValue } from "../contracts/state";
import { deterministicComparator } from "../comparator/deterministic";
import { compactShortTermMemory, createMemoryStep } from "../memory/compaction";
import type {
  CompiledControlSystem,
  ControlSystemConfig,
  InvokeInput,
  MemoryConfig,
  ObserverHandler,
  ObserverInput,
  ResumeInput,
  RuntimeExecutionContext,
  RuntimeRegistry,
  ToolExecutionContext,
  ToolRegistration,
  VerifierHandler,
  VerifierInput,
  VerifierResult
} from "./config";
import { SimulationSecurityError } from "./errors";

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

function createAuditLogRef(
  metadata: Record<string, JsonValue> | undefined,
  simulation: boolean
): string {
  const namespace = simulation ? "simulation" : "runtime";
  const traceId = readTraceId(metadata);
  return traceId ? `${namespace}-audit-${traceId}` : `${namespace}-audit-default`;
}

function createCheckpointId(auditLogRef: string, k: number, status: string): string {
  return `${auditLogRef}:checkpoint-${k}-${status}`;
}

function resolveObserver<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry
): ObserverHandler<TTarget, TCurrent> | undefined {
  if (!config.observerRef) {
    return undefined;
  }

  const observer = registry.observers?.[config.observerRef] as
    | ObserverHandler<TTarget, TCurrent>
    | undefined;
  if (!observer) {
    throw new Error(`Observer "${config.observerRef}" is not registered.`);
  }

  return observer;
}

function resolveVerifier<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry
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

function resolveModel<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry
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
  registry: RuntimeRegistry,
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
  registry: RuntimeRegistry,
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
  registry: RuntimeRegistry,
  args: {
    simulation: boolean;
    metadata?: Record<string, JsonValue>;
    checkpointId: string;
    bestCheckpointId?: string;
    k: number;
  }
): RuntimeExecutionContext {
  const traceId = readTraceId(args.metadata);
  const baseContext: ToolExecutionContext = {
    simulation: args.simulation,
    readOnly: args.simulation,
    checkpointId: args.checkpointId,
    ...(traceId ? { traceId } : {}),
    ...(args.bestCheckpointId ? { bestCheckpointId: args.bestCheckpointId } : {}),
    k: args.k,
    ...(config.modelRef ? { modelRef: config.modelRef } : {}),
    ...(config.modelRef ? { model: resolveModel(config, registry) } : {})
  };

  return {
    ...baseContext,
    invokeTool: createToolInvoker(config, registry, baseContext)
  };
}

function defaultDiagnostics(
  code: string,
  message: string,
  evidence?: Record<string, unknown>
): VerifierResult["diagnostics"] {
  return {
    code,
    message,
    ...(evidence ? { evidence } : {})
  };
}

function resolveIterationOutcome(
  verifierResult: VerifierResult | undefined,
  errorScore: number,
  epsilon: number,
  errorTrend: ControlState<unknown, unknown>["control"]["errorTrend"],
  iteration: number,
  maxIterations: number,
  errorHistory: number[]
): {
  status: ControlState<unknown, unknown>["runtime"]["status"];
  stopReason?: string;
  diagnostics?: VerifierResult["diagnostics"];
} {
  if (verifierResult?.status && verifierResult.status !== "optimizing") {
    return {
      status: verifierResult.status,
      ...(verifierResult.stopReason ? { stopReason: verifierResult.stopReason } : {}),
      ...(verifierResult.diagnostics ? { diagnostics: verifierResult.diagnostics } : {})
    };
  }

  if (errorScore <= epsilon) {
    return {
      status: "converged",
      stopReason: "epsilon-reached"
    };
  }

  if (errorTrend === "oscillating") {
    return {
      status: "stuck",
      stopReason: "oscillation-detected",
      diagnostics: defaultDiagnostics("oscillation-detected", "Error trend is oscillating.", {
        oscillationWindow: errorHistory.slice(-4)
      })
    };
  }

  const recentHistory = errorHistory.slice(-3);
  const isNonImproving =
    recentHistory.length === 3 &&
    recentHistory.every((value, index) =>
      index === 0 ? true : value >= (recentHistory[index - 1] ?? value)
    );
  if (isNonImproving) {
    return {
      status: "stuck",
      stopReason: "no-progress",
      diagnostics: defaultDiagnostics("no-progress", "Error score stopped improving.", {
        recentHistory
      })
    };
  }

  if (iteration + 1 >= maxIterations) {
    return {
      status: "failed",
      stopReason: "max-iterations-reached"
    };
  }

  return {
    status: "optimizing",
    ...(verifierResult?.stopReason ? { stopReason: verifierResult.stopReason } : {}),
    ...(verifierResult?.diagnostics ? { diagnostics: verifierResult.diagnostics } : {})
  };
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

  const scores = snapshot.control.shortTermMemory.steps
    .map((step) => step.errorScore)
    .filter((value): value is number => typeof value === "number");

  if (scores.length === 0) {
    return [snapshot.control.errorScore];
  }

  return scores;
}

function deriveBestErrorScore<TTarget, TCurrent>(snapshot: ControlState<TTarget, TCurrent>): number {
  return Math.min(snapshot.control.errorScore, ...extractErrorHistory(snapshot));
}

async function runControlLoop<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry,
  input: {
    target: TTarget;
    current: TCurrent;
    worldContext: Record<string, unknown>;
    simulation: boolean;
    metadata?: Record<string, JsonValue>;
    humanDecision?: Record<string, JsonValue>;
    startIteration: number;
    auditLogRef: string;
    existingState?: ControlState<TTarget, TCurrent>;
  }
): Promise<ControlState<TTarget, TCurrent>> {
  const validatedTarget = config.schemas?.target ? config.schemas.target.parse(input.target) : input.target;
  let currentState = config.schemas?.current ? config.schemas.current.parse(input.current) : input.current;
  const observer = resolveObserver(config, registry);
  const verifier = resolveVerifier(config, registry);
  const memoryConfig = {
    ...DEFAULT_MEMORY_CONFIG,
    ...(config.memory ?? {})
  };

  let bestErrorScore = input.existingState ? deriveBestErrorScore(input.existingState) : Number.POSITIVE_INFINITY;
  let bestCheckpointId = input.existingState?.runtime.bestCheckpointId;
  let currentSummary = input.existingState?.control.shortTermMemory.summary;
  let memoryHistory = [...(input.existingState?.control.shortTermMemory.steps ?? [])];
  const errorHistory = extractErrorHistory(input.existingState);

  for (let iteration = input.startIteration; iteration < config.stopPolicy.maxIterations; iteration += 1) {
    const provisionalCheckpointId = createCheckpointId(input.auditLogRef, iteration, "optimizing");
    const executionContext = createExecutionContext(config, registry, {
      simulation: input.simulation,
      checkpointId: provisionalCheckpointId,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(bestCheckpointId ? { bestCheckpointId } : {}),
      k: iteration
    });

    if (observer) {
      currentState = await observer({
        target: validatedTarget,
        current: currentState,
        worldContext: input.worldContext,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        executionContext
      } satisfies ObserverInput<TTarget, TCurrent>);
      currentState = config.schemas?.current ? config.schemas.current.parse(currentState) : currentState;
    }

    const previousErrorScore = errorHistory[errorHistory.length - 1];
    const comparison = config.comparator
      ? await config.comparator({
          target: validatedTarget,
          current: currentState,
          ...(previousErrorScore === undefined ? {} : { previousErrorScore })
        })
      : deterministicComparator<TTarget, TCurrent>({
          target: validatedTarget,
          current: currentState,
          ...(previousErrorScore === undefined ? {} : { previousErrorScore }),
          errorHistory: errorHistory.slice(0, -1)
        });

    const nextErrorHistory = [...errorHistory, comparison.errorScore];
    const verifierResult = verifier
      ? await verifier({
          target: validatedTarget,
          current: currentState,
          worldContext: input.worldContext,
          ...(input.metadata ? { metadata: input.metadata } : {}),
          comparison,
          history: nextErrorHistory,
          executionContext
        } satisfies VerifierInput<TTarget, TCurrent>)
      : undefined;

    const outcome = resolveIterationOutcome(
      verifierResult,
      comparison.errorScore,
      config.stopPolicy.epsilon,
      comparison.errorTrend,
      iteration,
      config.stopPolicy.maxIterations,
      nextErrorHistory
    );
    const checkpointId = createCheckpointId(input.auditLogRef, iteration, outcome.status);

    if (comparison.errorScore <= bestErrorScore) {
      bestErrorScore = comparison.errorScore;
      bestCheckpointId = checkpointId;
    }

    memoryHistory.push(
      createMemoryStep({
        kind: "comparison",
        message:
          outcome.status === "converged"
            ? "Converged."
            : outcome.status === "optimizing"
              ? "Iteration continuing."
              : `Stopped: ${outcome.stopReason ?? outcome.status}.`,
        errorScore: comparison.errorScore,
        ...(input.metadata ? { metadata: input.metadata } : {})
      })
    );

    const compactedMemory = await compactShortTermMemory(
      memoryHistory,
      {
        maxShortTermSteps: memoryConfig.maxShortTermSteps,
        strategy: memoryConfig.compactionStrategy,
        semantics: memoryConfig.summaryReplacementSemantics,
        auditLogRef: input.auditLogRef
      },
      registry.summarizeCompactedSteps
    );
    currentSummary = mergeSummary(currentSummary, compactedMemory.summary);
    memoryHistory = compactedMemory.steps;
    errorHistory.push(comparison.errorScore);

    const snapshot: ControlState<TTarget, TCurrent> = {
      control: {
        target: validatedTarget,
        current: currentState,
        worldContext: input.worldContext,
        errorVector: comparison.errorVector,
        errorScore: comparison.errorScore,
        deltaError: comparison.deltaError,
        errorTrend: comparison.errorTrend,
        shortTermMemory: {
          ...compactedMemory,
          ...(currentSummary ? { summary: currentSummary } : {})
        },
        ...(comparison.prediction ? { prediction: comparison.prediction } : {})
      },
      runtime: {
        k: iteration,
        status: outcome.status,
        ...(outcome.stopReason ? { stopReason: outcome.stopReason } : {}),
        ...(outcome.diagnostics ? { diagnostics: outcome.diagnostics } : {}),
        auditLogRef: input.auditLogRef,
        checkpointId,
        ...(bestCheckpointId ? { bestCheckpointId } : {}),
        simulation: input.simulation,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.humanDecision ? { humanDecision: input.humanDecision } : {})
      }
    };

    if (outcome.status !== "optimizing") {
      return snapshot;
    }
  }

  throw new Error("Control loop exited unexpectedly without a terminal state.");
}

function updateSnapshotStatus<TTarget, TCurrent>(
  snapshot: ControlState<TTarget, TCurrent>,
  status: ControlState<TTarget, TCurrent>["runtime"]["status"],
  stopReason: string,
  humanDecision?: Record<string, JsonValue>
): ControlState<TTarget, TCurrent> {
  const auditLogRef =
    snapshot.runtime.auditLogRef ?? createAuditLogRef(snapshot.runtime.metadata, snapshot.runtime.simulation);
  const checkpointId = createCheckpointId(auditLogRef, snapshot.runtime.k, status);

  return {
    control: snapshot.control,
    runtime: {
      ...snapshot.runtime,
      status,
      stopReason,
      auditLogRef,
      checkpointId,
      ...(humanDecision
        ? {
            humanDecision: {
              ...(snapshot.runtime.humanDecision ?? {}),
              ...humanDecision
            }
          }
        : {})
    }
  };
}

export function compileControlSystem<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  runtimeRegistry: RuntimeRegistry = {}
): CompiledControlSystem<TTarget, TCurrent> {
  return {
    config,
    async invoke(input) {
      const metadata = normalizeMetadata(config.metadata, input.metadata);
      return runControlLoop(config, runtimeRegistry, {
        target: input.target,
        current: input.current,
        worldContext: input.worldContext ?? {},
        simulation: input.simulation ?? false,
        ...(metadata ? { metadata } : {}),
        startIteration: 0,
        auditLogRef: createAuditLogRef(metadata, input.simulation ?? false)
      });
    },
    async interrupt(snapshot, humanDecision) {
      return updateSnapshotStatus(
        snapshot,
        "awaiting_human_intervention",
        "interrupt",
        humanDecision
      );
    },
    async resume(snapshot, input: ResumeInput<TCurrent> = {}) {
      if (input.humanDecision?.action === "abort") {
        return updateSnapshotStatus(snapshot, "aborted", "abort", input.humanDecision);
      }

      const mergedInput: InvokeInput<TTarget, TCurrent> = {
        target: snapshot.control.target,
        current: input.current ?? snapshot.control.current,
        worldContext: snapshot.control.worldContext,
        simulation: snapshot.runtime.simulation,
        ...(snapshot.runtime.metadata ? { metadata: snapshot.runtime.metadata } : {})
      };

      return runControlLoop(config, runtimeRegistry, {
        target: mergedInput.target,
        current: mergedInput.current,
        worldContext: mergedInput.worldContext ?? {},
        simulation: mergedInput.simulation ?? false,
        ...(mergedInput.metadata ? { metadata: mergedInput.metadata } : {}),
        ...(input.humanDecision ? { humanDecision: input.humanDecision } : {}),
        startIteration: snapshot.runtime.k + 1,
        auditLogRef:
          snapshot.runtime.auditLogRef ??
          createAuditLogRef(mergedInput.metadata, mergedInput.simulation ?? false),
        existingState: snapshot
      });
    },
    async abort(snapshot, humanDecision) {
      return updateSnapshotStatus(snapshot, "aborted", "abort", humanDecision);
    }
  };
}
