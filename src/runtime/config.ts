import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseCheckpointSaver, CompiledStateGraph } from "@langchain/langgraph";
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

export type ComparatorHandler<TTarget, TCurrent> = (
  input: ComparatorInput<TTarget, TCurrent>
) => ComparatorResult | Promise<ComparatorResult>;

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

export interface TokenBudgetEstimatorInput<TTarget, TCurrent> {
  target: TTarget;
  current: TCurrent;
  worldContext: Record<string, unknown>;
  metadata?: Record<string, JsonValue>;
  comparison: ComparatorResult;
  verifierResult?: VerifierResult;
  executionContext: RuntimeExecutionContext;
}

export type TokenBudgetEstimator<TTarget, TCurrent> = (
  input: TokenBudgetEstimatorInput<TTarget, TCurrent>
) => number | Promise<number>;

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
  /**
   * Canonical extension point for non-default comparator logic.
   *
   * Keeping it as a reference makes `ControlSystemConfig` JSON-ready.
   */
  comparatorRef?: string;
}

export interface RuntimeRegistry<TTarget = unknown, TCurrent = unknown> {
  summarizeCompactedSteps?: SummarizeCompactedSteps;
  models?: Record<string, unknown>;
  observers?: Record<string, ObserverHandler<TTarget, TCurrent>>;
  verifiers?: Record<string, VerifierHandler<TTarget, TCurrent>>;
  comparators?: Record<string, ComparatorHandler<TTarget, TCurrent>>;
  tools?: Record<string, ToolRegistration>;
  tokenBudgetEstimator?: TokenBudgetEstimator<TTarget, TCurrent>;
  checkpointer?: BaseCheckpointSaver;
}

export interface ControlThreadStateInput {
  threadId: string;
  simulation?: boolean;
  checkpointId?: string;
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
  readonly graph: CompiledStateGraph<
    ControlState<TTarget, TCurrent>,
    Partial<ControlState<TTarget, TCurrent>>,
    string
  >;
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
  getState(input: ControlThreadStateInput): Promise<ControlState<TTarget, TCurrent>>;
  getThreadConfig(input: ControlThreadStateInput): RunnableConfig;

  /**
   * Subscribe to library lifecycle telemetry.
   *
   * Note: listeners are closure-side effects and must not be stored in checkpointed state.
   */
  on<E extends PrecuratorTelemetryEventName>(
    eventName: E,
    listener: (payload: PrecuratorTelemetryEventPayloadMap[E]) => void
  ): void;
}

export type PrecuratorTelemetryEventName = "step:completed" | "step:interrupted";

export type TelemetryControlStepType = "Observation" | "Comparison" | "Prediction" | "Execution";

export interface StepCompletedTelemetryPayload {
  control_step_type: TelemetryControlStepType;
  error_score: number;
  delta_error: number;
  error_trend: ErrorTrend;
  simulation: boolean;
  checkpoint_id: string;
  thread_id?: string;
}

export interface StepInterruptedTelemetryPayload extends StepCompletedTelemetryPayload {
  human_intervention_reason?: string;
  stop_reason?: string;
}

export interface PrecuratorTelemetryEventPayloadMap {
  "step:completed": StepCompletedTelemetryPayload;
  "step:interrupted": StepInterruptedTelemetryPayload;
}
