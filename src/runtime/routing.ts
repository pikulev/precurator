import { END } from "@langchain/langgraph";

import type { ControlState } from "../contracts/state";
import type { VerifierResult } from "./config";

type RuntimeStatus = ControlState<unknown, unknown>["runtime"]["status"];
type RuntimeDiagnostics = ControlState<unknown, unknown>["runtime"]["diagnostics"];

export type ControlRoute = "observe" | "interrupt" | typeof END;

export interface ShouldContinueInput {
  status: RuntimeStatus;
  errorScore: number;
  epsilon: number;
}

export interface ResolveIterationOutcomeInput {
  verifierResult?: VerifierResult;
  errorScore: number;
  epsilon: number;
  errorTrend: ControlState<unknown, unknown>["control"]["errorTrend"];
  iteration: number;
  maxIterations: number;
  errorHistory: number[];
  tokenBudget?: {
    maxTokenBudget: number;
    nextTokenBudgetUsed: number;
  };
}

export interface IterationOutcome {
  status: RuntimeStatus;
  stopReason?: string;
  diagnostics?: RuntimeDiagnostics;
}

function createDiagnostics(
  code: string,
  message: string,
  evidence?: Record<string, unknown>
): RuntimeDiagnostics {
  return {
    code,
    message,
    ...(evidence ? { evidence } : {})
  };
}

export function resolveIterationOutcome(
  input: ResolveIterationOutcomeInput
): IterationOutcome {
  const {
    verifierResult,
    errorScore,
    epsilon,
    errorTrend,
    iteration,
    maxIterations,
    errorHistory,
    tokenBudget
  } = input;

  if (
    tokenBudget &&
    tokenBudget.nextTokenBudgetUsed > tokenBudget.maxTokenBudget
  ) {
    return {
      status: "failed",
      stopReason: "max-token-budget-reached",
      diagnostics: createDiagnostics(
        "max-token-budget-reached",
        "Token budget exhausted.",
        {
          maxTokenBudget: tokenBudget.maxTokenBudget,
          tokenBudgetUsed: tokenBudget.nextTokenBudgetUsed
        }
      )
    };
  }

  if (verifierResult?.status && verifierResult.status !== "optimizing") {
    return {
      status: verifierResult.status,
      ...(verifierResult.stopReason
        ? { stopReason: verifierResult.stopReason }
        : {}),
      ...(verifierResult.diagnostics
        ? { diagnostics: verifierResult.diagnostics }
        : {})
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
      diagnostics: createDiagnostics(
        "oscillation-detected",
        "Error trend is oscillating.",
        {
          oscillationWindow: errorHistory.slice(-4)
        }
      )
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
      diagnostics: createDiagnostics(
        "no-progress",
        "Error score stopped improving.",
        {
          recentHistory
        }
      )
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

export function shouldContinue(input: ShouldContinueInput): ControlRoute {
  if (input.status === "awaiting_human_intervention") {
    return "interrupt";
  }

  if (input.status !== "optimizing") {
    return END;
  }

  return input.errorScore <= input.epsilon ? END : "observe";
}
