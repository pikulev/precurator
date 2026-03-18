import type { ZodType } from "zod";

import type {
  CompactionStrategy,
  ControlState,
  ErrorTrend,
  JsonValue,
  RuntimeContext,
  RuntimeDiagnostics,
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

export interface ToolExecutionContext {
  simulation: boolean;
  readOnly: boolean;
  traceId?: string;
  checkpointId?: string;
  bestCheckpointId?: string;
  k: number;
  modelRef?: string;
  model?: unknown;
}

export interface RuntimeExecutionContext extends ToolExecutionContext {
  invokeTool(toolRef: string, input?: JsonValue | Record<string, unknown>): Promise<unknown>;
}

export interface ToolInvocation {
  input?: JsonValue | Record<string, unknown>;
  executionContext: ToolExecutionContext;
}

export interface ToolRegistration {
  destructive?: boolean;
  execute(input: ToolInvocation): unknown | Promise<unknown>;
  dryRun?: (input: ToolInvocation) => unknown | Promise<unknown>;
}

export interface ObserverInput<TTarget, TCurrent> {
  target: TTarget;
  current: TCurrent;
  worldContext: Record<string, unknown>;
  metadata?: Record<string, JsonValue>;
  executionContext: RuntimeExecutionContext;
}

export type ObserverHandler<TTarget, TCurrent> = (
  input: ObserverInput<TTarget, TCurrent>
) => TCurrent | Promise<TCurrent>;

export interface VerifierInput<TTarget, TCurrent> {
  target: TTarget;
  current: TCurrent;
  worldContext: Record<string, unknown>;
  metadata?: Record<string, JsonValue>;
  comparison: ComparatorResult;
  history: number[];
  executionContext: RuntimeExecutionContext;
}

export interface VerifierResult {
  status?: RuntimeContext["status"];
  stopReason?: string;
  diagnostics?: RuntimeDiagnostics;
}

export type VerifierHandler<TTarget, TCurrent> = (
  input: VerifierInput<TTarget, TCurrent>
) => VerifierResult | Promise<VerifierResult>;

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
  models?: Record<string, unknown>;
  observers?: Record<string, ObserverHandler<any, any>>;
  verifiers?: Record<string, VerifierHandler<any, any>>;
  tools?: Record<string, ToolRegistration>;
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
  abort(
    snapshot: ControlState<TTarget, TCurrent>,
    humanDecision?: Record<string, JsonValue>
  ): Promise<ControlState<TTarget, TCurrent>>;
}
