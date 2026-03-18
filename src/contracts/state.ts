export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type StructuredErrorValue = number | string | boolean | null;
export type StructuredErrorVector = Record<string, StructuredErrorValue>;

export type ErrorTrend = "improving" | "flat" | "degrading" | "oscillating";
export type CompactionStrategy = "sliding-window" | "summarize-oldest" | "hybrid";
export type SummaryReplacementSemantics =
  | "replace-compacted-steps"
  | "replace-all-but-recent-window";

export interface ControlStep {
  kind: "observation" | "comparison" | "prediction" | "execution" | "validation";
  message: string;
  errorScore?: number;
  timestamp: string;
  metadata?: Record<string, JsonValue>;
}

export interface ShortTermMemoryWindow {
  steps: ControlStep[];
  maxShortTermSteps: number;
  compactionStrategy: CompactionStrategy;
  summaryReplacementSemantics: SummaryReplacementSemantics;
  summary?: string;
}

export interface CompactionContext {
  maxShortTermSteps: number;
  strategy: CompactionStrategy;
  semantics: SummaryReplacementSemantics;
  auditLogRef?: string;
}

export type CompactShortTermMemory = (
  history: ControlStep[],
  context: CompactionContext
) => ShortTermMemoryWindow;

export interface ControlBasis<TTarget, TCurrent> {
  target: TTarget;
  current: TCurrent;
  worldContext: Record<string, unknown>;
  errorVector: StructuredErrorVector;
  errorScore: number;
  deltaError: number;
  errorTrend: ErrorTrend;
  shortTermMemory: ShortTermMemoryWindow;
  prediction?: string;
}

export interface RuntimeDiagnostics {
  code: string;
  message: string;
  evidence?: Record<string, unknown>;
  lastRepeatedAction?: string;
  oscillationWindow?: number[];
  recommendedAction?: "retry-conservative" | "interrupt" | "abort" | "human-override";
}

export interface RuntimeContext {
  k: number;
  status:
    | "optimizing"
    | "converged"
    | "stuck"
    | "failed"
    | "awaiting_human_intervention"
    | "aborted";
  stopReason?: string;
  diagnostics?: RuntimeDiagnostics;
  auditLogRef?: string;
  checkpointId?: string;
  bestCheckpointId?: string;
  tokenBudgetUsed?: number;
  simulation: boolean;
  metadata?: Record<string, JsonValue>;
  humanDecision?: Record<string, JsonValue>;
}

export interface ControlState<TTarget, TCurrent> {
  control: ControlBasis<TTarget, TCurrent>;
  runtime: RuntimeContext;
}
