import type { ZodType } from "zod";

import type {
  CompactionStrategy,
  ControlState,
  ErrorTrend,
  JsonValue,
  SummaryReplacementSemantics,
  StructuredErrorVector
} from "../contracts/state";
import type { SummarizeCompactedSteps } from "../memory/compaction";

export interface ComparatorInput<TTarget, TCurrent> {
  target: TTarget;
  current: TCurrent;
  previousErrorScore?: number;
}

export interface ComparatorResult {
  errorVector: StructuredErrorVector;
  errorScore: number;
  deltaError: number;
  errorTrend: ErrorTrend;
  prediction?: string;
}

export interface SchemaContract<TTarget, TCurrent> {
  target?: ZodType<TTarget>;
  current?: ZodType<TCurrent>;
}

export interface MemoryConfig {
  maxShortTermSteps: number;
  compactionStrategy: CompactionStrategy;
  summaryReplacementSemantics: SummaryReplacementSemantics;
}

export interface StopPolicy {
  epsilon: number;
  maxIterations: number;
  maxTokenBudget?: number;
}

export interface ControlSystemConfig<TTarget, TCurrent> {
  schemas?: SchemaContract<TTarget, TCurrent>;
  stopPolicy: StopPolicy;
  memory?: Partial<MemoryConfig>;
  mode?: "conservative" | "balanced" | "aggressive";
  modelRef?: string;
  observerRef?: string;
  verifierRef?: string;
  toolRefs?: string[];
  metadata?: Record<string, JsonValue>;
  comparator?: (
    input: ComparatorInput<TTarget, TCurrent>
  ) => ComparatorResult | Promise<ComparatorResult>;
}

export interface RuntimeRegistry {
  summarizeCompactedSteps?: SummarizeCompactedSteps;
}

export interface InvokeInput<TTarget, TCurrent> {
  target: TTarget;
  current: TCurrent;
  worldContext?: Record<string, unknown>;
  simulation?: boolean;
  metadata?: Record<string, JsonValue>;
}

export interface ResumeInput<TCurrent> {
  current?: TCurrent;
  humanDecision?: Record<string, JsonValue>;
}

export interface CompiledControlSystem<TTarget, TCurrent> {
  readonly config: Readonly<ControlSystemConfig<TTarget, TCurrent>>;
  invoke(input: InvokeInput<TTarget, TCurrent>): Promise<ControlState<TTarget, TCurrent>>;
  interrupt(
    snapshot: ControlState<TTarget, TCurrent>,
    humanDecision?: Record<string, JsonValue>
  ): Promise<ControlState<TTarget, TCurrent>>;
  resume(
    snapshot: ControlState<TTarget, TCurrent>,
    input?: ResumeInput<TCurrent>
  ): Promise<ControlState<TTarget, TCurrent>>;
}
