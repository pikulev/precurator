import type { ErrorTrend } from "../../src";
import type {
  StepCompletedTelemetryPayload,
  StepInterruptedTelemetryPayload
} from "../../src/runtime/config";
import type { AeolusCurrent, AeolusTarget, AeolusVector } from "./domain";
import { formatDisturbanceDelta } from "./domain";

export interface AeolusStepSnapshot {
  k: number;
  simulation: boolean;
  actualPosition: AeolusVector;
  predictedPosition: AeolusVector;
  controlForce: AeolusVector;
  noiseForce: AeolusVector;
  disturbanceDelta: AeolusVector;
  disturbanceMagnitude: number;
  reasoningTrace: string;
  errorScore?: number;
  deltaError?: number;
  errorTrend?: ErrorTrend;
  status?: string;
  stopReason?: string;
  checkpointId?: string;
  verifierAlert?: string;
  diagnosticsCode?: string;
  compactionToast?: string;
}

export interface AeolusAuditRow {
  k: number;
  disturbanceDelta: string;
  expectedPosition: string;
  actualPosition: string;
  errorScore: string;
  deltaError: string;
  errorTrend: string;
}

export interface AeolusRunReport {
  threadId: string;
  simulation: boolean;
  finalStatus: string;
  finalStopReason?: string;
  finalDiagnosticsCode?: string;
  previewPath: AeolusVector[];
  steps: AeolusStepSnapshot[];
  auditLog: AeolusAuditRow[];
}

export interface AeolusReport {
  generatedAt: string;
  target: AeolusTarget;
  runs: {
    simulation: AeolusRunReport;
    reality: AeolusRunReport;
  };
  notes: string[];
}

interface RunCollector {
  threadId: string;
  simulation: boolean;
  previewPath: AeolusVector[];
  steps: AeolusStepSnapshot[];
  pendingCompactionToasts: string[];
}

export class AeolusReportCollector {
  private readonly runs = new Map<string, RunCollector>();

  registerRun(input: {
    threadId: string;
    simulation: boolean;
    previewPath: AeolusVector[];
  }): void {
    this.runs.set(input.threadId, {
      threadId: input.threadId,
      simulation: input.simulation,
      previewPath: input.previewPath,
      steps: [],
      pendingCompactionToasts: []
    });
  }

  recordObservation(input: {
    threadId: string;
    k: number;
    simulation: boolean;
    current: AeolusCurrent;
  }): void {
    const run = this.getRun(input.threadId);
    const existing = run.steps.find((step) => step.k === input.k);
    const baseStep: AeolusStepSnapshot = {
      k: input.k,
      simulation: input.simulation,
      actualPosition: input.current.position,
      predictedPosition: input.current.predictedPosition,
      controlForce: input.current.controlForce,
      noiseForce: input.current.noiseForce,
      disturbanceDelta: input.current.disturbanceDelta,
      disturbanceMagnitude: input.current.disturbanceMagnitude,
      reasoningTrace: input.current.reasoningTrace
    };

    if (existing) {
      Object.assign(existing, baseStep);
    } else {
      run.steps.push(baseStep);
      run.steps.sort((a, b) => a.k - b.k);
    }
  }

  recordVerifier(input: {
    threadId: string;
    verifierAlert?: string;
    diagnosticsCode?: string;
    stopReason?: string;
  }): void {
    const step = this.findLatestStep(input.threadId);
    if (!step) {
      return;
    }

    if (input.verifierAlert) {
      step.verifierAlert = input.verifierAlert;
    }

    if (input.diagnosticsCode) {
      step.diagnosticsCode = input.diagnosticsCode;
    }

    if (input.stopReason) {
      step.stopReason = input.stopReason;
    }
  }

  recordCompletedTelemetry(payload: StepCompletedTelemetryPayload): void {
    if (!payload.thread_id) {
      return;
    }

    const step = this.findLatestOpenStep(payload.thread_id);
    if (!step) {
      return;
    }

    step.errorScore = payload.error_score;
    step.deltaError = payload.delta_error;
    step.errorTrend = payload.error_trend;
    step.checkpointId = payload.checkpoint_id;
    step.status = "optimizing";

    const run = this.getRun(payload.thread_id);
    if (run.pendingCompactionToasts.length > 0 && step.compactionToast === undefined) {
      const nextToast = run.pendingCompactionToasts.shift();
      if (nextToast !== undefined) {
        step.compactionToast = nextToast;
      }
    }
  }

  recordInterruptedTelemetry(payload: StepInterruptedTelemetryPayload): void {
    if (!payload.thread_id) {
      return;
    }

    const step = this.findLatestOpenStep(payload.thread_id);
    if (!step) {
      return;
    }

    step.status = "awaiting_human_intervention";
    if (payload.stop_reason !== undefined) {
      step.stopReason = payload.stop_reason;
    }
    step.checkpointId = payload.checkpoint_id;
  }

  queueCompactionToast(threadId: string, toast: string): void {
    const run = this.getRun(threadId);
    run.pendingCompactionToasts.push(toast);
  }

  finalizeRun(input: {
    threadId: string;
    finalStatus: string;
    finalStopReason?: string;
    finalDiagnosticsCode?: string;
  }): AeolusRunReport {
    const run = this.getRun(input.threadId);

    if (run.steps.length > 0) {
      const lastStep = run.steps[run.steps.length - 1]!;
      if (run.pendingCompactionToasts.length > 0 && lastStep.compactionToast === undefined) {
        const [nextToast] = run.pendingCompactionToasts;
        if (nextToast !== undefined) {
          lastStep.compactionToast = nextToast;
        }
      }
      lastStep.status = input.finalStatus;
      if (input.finalStopReason) {
        lastStep.stopReason = input.finalStopReason;
      }
    }

    return {
      threadId: input.threadId,
      simulation: run.simulation,
      finalStatus: input.finalStatus,
      ...(input.finalStopReason ? { finalStopReason: input.finalStopReason } : {}),
      ...(input.finalDiagnosticsCode
        ? { finalDiagnosticsCode: input.finalDiagnosticsCode }
        : {}),
      previewPath: run.previewPath,
      steps: [...run.steps],
      auditLog: buildAuditLog(run.steps)
    };
  }

  private findLatestOpenStep(threadId: string): AeolusStepSnapshot | undefined {
    const run = this.getRun(threadId);
    const reversed = [...run.steps].reverse();
    return reversed.find((step) => step.errorScore === undefined) ?? reversed[0];
  }

  private findLatestStep(threadId: string): AeolusStepSnapshot | undefined {
    const run = this.getRun(threadId);
    return run.steps[run.steps.length - 1];
  }

  private getRun(threadId: string): RunCollector {
    const run = this.runs.get(threadId);
    if (!run) {
      throw new Error(`Unknown Aeolus run: ${threadId}`);
    }

    return run;
  }
}

function buildAuditLog(steps: AeolusStepSnapshot[]): AeolusAuditRow[] {
  return steps.map((step) => ({
    k: step.k,
    disturbanceDelta: formatDisturbanceDelta(step.disturbanceDelta),
    expectedPosition: formatPoint(step.predictedPosition),
    actualPosition: formatPoint(step.actualPosition),
    errorScore: formatMetric(step.errorScore),
    deltaError: formatMetric(step.deltaError),
    errorTrend: step.errorTrend ?? "n/a"
  }));
}

function formatPoint(point: AeolusVector): string {
  return `${point.x.toFixed(2)}, ${point.y.toFixed(2)}`;
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? "n/a" : value.toFixed(3);
}
