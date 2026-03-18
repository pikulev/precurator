import type { ComparatorResult, VerifierResult } from "./config";
import type { JsonValue } from "../contracts/state";
import { PrecuratorValidationError } from "./errors";
import { assertJsonReadySerializable } from "./serializability";

const ALLOWED_ERROR_TRENDS = new Set([
  "improving",
  "flat",
  "degrading",
  "oscillating"
] as const);

const ALLOWED_RUNTIME_STATUSES = new Set([
  "optimizing",
  "converged",
  "stuck",
  "failed",
  "awaiting_human_intervention",
  "aborted"
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  // `assertJsonReadySerializable` is strict about plain objects. Here we just validate value-level types.
  return (
    value === null ||
    ["string", "number", "boolean"].includes(typeof value) ||
    Array.isArray(value) ||
    isRecord(value)
  );
}

export function assertComparatorResultShape(
  value: unknown,
  label = "comparator.result"
): asserts value is ComparatorResult {
  assertJsonReadySerializable(value, label);

  if (!isRecord(value)) {
    throw new PrecuratorValidationError(`Invalid ${label}: expected an object.`);
  }

  const { errorVector, errorScore, deltaError, errorTrend, prediction } = value;

  if (!isRecord(errorVector)) {
    throw new PrecuratorValidationError(`Invalid ${label}.errorVector: expected a record.`);
  }

  for (const [k, v] of Object.entries(errorVector)) {
    if (v !== null && !["string", "number", "boolean"].includes(typeof v)) {
      throw new PrecuratorValidationError(
        `Invalid ${label}.errorVector["${k}"]: expected Json primitive or null.`
      );
    }
  }

  if (!isFiniteNumber(errorScore)) {
    throw new PrecuratorValidationError(`Invalid ${label}.errorScore: expected a finite number.`, {
      errorScore
    });
  }

  if (errorScore < 0 || errorScore > 1) {
    throw new PrecuratorValidationError(
      `Invalid ${label}.errorScore: expected a value in [0, 1].`,
      { errorScore }
    );
  }

  if (!isFiniteNumber(deltaError)) {
    throw new PrecuratorValidationError(`Invalid ${label}.deltaError: expected a finite number.`, {
      deltaError
    });
  }

  if (typeof errorTrend !== "string" || !ALLOWED_ERROR_TRENDS.has(errorTrend as never)) {
    throw new PrecuratorValidationError(`Invalid ${label}.errorTrend: unexpected value.`, {
      errorTrend
    });
  }

  if (prediction !== undefined && typeof prediction !== "string") {
    throw new PrecuratorValidationError(`Invalid ${label}.prediction: expected string.`, {
      prediction
    });
  }
}

export function assertVerifierResultShape(
  value: unknown,
  label = "verifier.result"
): asserts value is VerifierResult {
  if (value === undefined) {
    // Caller may validate only when present.
    return;
  }

  assertJsonReadySerializable(value, label);

  if (!isRecord(value)) {
    throw new PrecuratorValidationError(`Invalid ${label}: expected an object.`);
  }

  const { status, stopReason, diagnostics } = value;

  if (status !== undefined) {
    if (
      typeof status !== "string" ||
      !ALLOWED_RUNTIME_STATUSES.has(status as never)
    ) {
      throw new PrecuratorValidationError(`Invalid ${label}.status: unexpected value.`, {
        status
      });
    }
  }

  if (stopReason !== undefined && typeof stopReason !== "string") {
    throw new PrecuratorValidationError(`Invalid ${label}.stopReason: expected string.`, {
      stopReason
    });
  }

  if (diagnostics !== undefined) {
    assertJsonReadySerializable(diagnostics, `${label}.diagnostics`);

    if (!isRecord(diagnostics)) {
      throw new PrecuratorValidationError(
        `Invalid ${label}.diagnostics: expected an object.`
      );
    }

    if (typeof diagnostics.code !== "string" || typeof diagnostics.message !== "string") {
      throw new PrecuratorValidationError(
        `Invalid ${label}.diagnostics: "code" and "message" must be strings.`,
        diagnostics
      );
    }

    if (diagnostics.evidence !== undefined && !isRecord(diagnostics.evidence)) {
      throw new PrecuratorValidationError(
        `Invalid ${label}.diagnostics.evidence: expected a record.`,
        diagnostics.evidence
      );
    }
  }
}

export function assertJsonReady<T>(value: T, label: string): T {
  assertJsonReadySerializable(value, label);
  return value;
}

