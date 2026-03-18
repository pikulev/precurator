import type { ControlState, JsonValue } from "../contracts/state";
import { deterministicComparator } from "../comparator/deterministic";
import { compactShortTermMemory, createMemoryStep } from "../memory/compaction";
import type {
  CompiledControlSystem,
  ControlSystemConfig,
  InvokeInput,
  MemoryConfig,
  ResumeInput,
  RuntimeRegistry
} from "./config";

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

function createCheckpointId(k: number, status: string): string {
  return `checkpoint-${k}-${status}`;
}

async function buildState<TTarget, TCurrent>(
  config: ControlSystemConfig<TTarget, TCurrent>,
  registry: RuntimeRegistry,
  input: InvokeInput<TTarget, TCurrent>,
  k: number,
  previousErrorScore?: number,
  humanDecision?: Record<string, JsonValue>
): Promise<ControlState<TTarget, TCurrent>> {
  const validatedTarget = config.schemas?.target ? config.schemas.target.parse(input.target) : input.target;
  const validatedCurrent = config.schemas?.current
    ? config.schemas.current.parse(input.current)
    : input.current;
  const comparator = config.comparator ?? deterministicComparator<TTarget, TCurrent>;
  const comparison = await comparator({
    target: validatedTarget,
    current: validatedCurrent,
    ...(previousErrorScore === undefined ? {} : { previousErrorScore })
  });

  const memoryConfig = {
    ...DEFAULT_MEMORY_CONFIG,
    ...(config.memory ?? {})
  };
  const checkpointId = createCheckpointId(
    k,
    comparison.errorScore <= config.stopPolicy.epsilon ? "converged" : "optimizing"
  );
  const metadata = normalizeMetadata(config.metadata, input.metadata);
  const shortTermMemory = await compactShortTermMemory(
    [
      createMemoryStep({
        kind: "comparison",
        message: comparison.errorScore <= config.stopPolicy.epsilon ? "Converged." : "Awaiting next step.",
        errorScore: comparison.errorScore,
        ...(metadata ? { metadata } : {})
      })
    ],
    {
      maxShortTermSteps: memoryConfig.maxShortTermSteps,
      strategy: memoryConfig.compactionStrategy,
      semantics: memoryConfig.summaryReplacementSemantics,
      auditLogRef: checkpointId
    },
    registry.summarizeCompactedSteps
  );

  return {
    control: {
      target: validatedTarget,
      current: validatedCurrent,
      worldContext: input.worldContext ?? {},
      errorVector: comparison.errorVector,
      errorScore: comparison.errorScore,
      deltaError: comparison.deltaError,
      errorTrend: comparison.errorTrend,
      shortTermMemory,
      ...(comparison.prediction ? { prediction: comparison.prediction } : {})
    },
    runtime: {
      k,
      status: comparison.errorScore <= config.stopPolicy.epsilon ? "converged" : "optimizing",
      ...(comparison.errorScore <= config.stopPolicy.epsilon ? { stopReason: "epsilon-reached" } : {}),
      auditLogRef: checkpointId,
      checkpointId,
      ...(comparison.errorScore <= config.stopPolicy.epsilon ? { bestCheckpointId: checkpointId } : {}),
      simulation: input.simulation ?? false,
      ...(metadata ? { metadata } : {}),
      ...(humanDecision ? { humanDecision } : {})
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
      return buildState(config, runtimeRegistry, input, 0);
    },
    async interrupt(snapshot, humanDecision) {
      return {
        control: snapshot.control,
        runtime: {
          ...snapshot.runtime,
          status: "awaiting_human_intervention",
          stopReason: "interrupt",
          ...(humanDecision ? { humanDecision } : {})
        }
      };
    },
    async resume(snapshot, input: ResumeInput<TCurrent> = {}) {
      const mergedInput: InvokeInput<TTarget, TCurrent> = {
        target: snapshot.control.target,
        current: input.current ?? snapshot.control.current,
        worldContext: snapshot.control.worldContext,
        simulation: snapshot.runtime.simulation,
        ...(snapshot.runtime.metadata ? { metadata: snapshot.runtime.metadata } : {})
      };

      return buildState(
        config,
        runtimeRegistry,
        mergedInput,
        snapshot.runtime.k + 1,
        snapshot.control.errorScore,
        input.humanDecision
      );
    }
  };
}
