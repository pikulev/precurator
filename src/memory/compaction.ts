import type {
  CompactShortTermMemory,
  CompactionContext,
  ControlStep,
  JsonValue,
  ShortTermMemoryWindow
} from "../contracts/state";

export interface SummarizeCompactedStepsInput {
  compacted: ControlStep[];
  context: CompactionContext;
}

export type SummarizeCompactedSteps = (
  input: SummarizeCompactedStepsInput
) => string | Promise<string>;

function formatFallbackSummary(compacted: ControlStep[], auditLogRef?: string): string {
  if (compacted.length === 0) {
    return auditLogRef
      ? `No compacted steps. Full audit log: ${auditLogRef}.`
      : "No compacted steps.";
  }

  const parts = compacted.map((step) => `${step.kind}:${step.message}`);
  const prefix = `Compacted ${compacted.length} step(s)`;
  const suffix = auditLogRef ? ` Full audit log: ${auditLogRef}.` : "";

  return `${prefix}. ${parts.join(" | ")}.${suffix}`;
}

function mergeMetadata(summary: string, compactedCount: number): Record<string, JsonValue> {
  return {
    compactedCount,
    summary
  };
}

export async function compactShortTermMemory(
  history: ControlStep[],
  context: CompactionContext,
  summarizeCompactedSteps?: SummarizeCompactedSteps
): Promise<ShortTermMemoryWindow> {
  const recentSteps =
    history.length > context.maxShortTermSteps
      ? history.slice(-context.maxShortTermSteps)
      : [...history];

  const compacted =
    history.length > context.maxShortTermSteps
      ? history.slice(0, history.length - context.maxShortTermSteps)
      : [];

  let summary: string | undefined;
  if (compacted.length > 0 && context.strategy !== "sliding-window") {
    summary = summarizeCompactedSteps
      ? await summarizeCompactedSteps({ compacted, context })
      : formatFallbackSummary(compacted, context.auditLogRef);
  }

  return {
    steps: recentSteps,
    maxShortTermSteps: context.maxShortTermSteps,
    compactionStrategy: context.strategy,
    summaryReplacementSemantics: context.semantics,
    ...(summary ? { summary } : {})
  };
}

export function createMemoryStep(
  step: Omit<ControlStep, "timestamp"> & { timestamp?: string }
): ControlStep {
  return {
    ...step,
    timestamp: step.timestamp ?? new Date().toISOString(),
    ...(step.metadata
      ? {
          metadata: {
            ...step.metadata,
            ...mergeMetadata(step.message, 1)
          }
        }
      : {})
  };
}

export type { CompactShortTermMemory };
