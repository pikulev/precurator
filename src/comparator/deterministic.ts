import type {
  ErrorTrend,
  StructuredErrorVector
} from "../contracts/state";
import type {
  ComparatorInput,
  ComparatorResult
} from "../runtime/config";

export interface DeterministicComparatorInput<TTarget, TCurrent>
  extends ComparatorInput<TTarget, TCurrent> {
  errorHistory?: number[];
}

export interface ErrorTrendOptions {
  flatTolerance?: number;
  oscillationWindow?: number;
  oscillationAmplitude?: number;
}

interface StructuralComparison {
  errorScore: number;
  errorVector: StructuredErrorVector;
  weight: number;
}

const DEFAULT_TREND_OPTIONS: Required<ErrorTrendOptions> = {
  flatTolerance: 0.0001,
  oscillationWindow: 4,
  oscillationAmplitude: 0.2
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mergeErrorVectors(parts: StructuredErrorVector[]): StructuredErrorVector {
  return Object.assign({}, ...parts);
}

function compareValue(target: unknown, current: unknown, path: string): StructuralComparison {
  if (Object.is(target, current)) {
    return {
      errorScore: 0,
      errorVector: {},
      weight: 1
    };
  }

  if (
    target === null ||
    current === null ||
    typeof target !== "object" ||
    typeof current !== "object"
  ) {
    return {
      errorScore: 1,
      errorVector: path ? { [path]: 1 } : { root: 1 },
      weight: 1
    };
  }

  if (Array.isArray(target) && Array.isArray(current)) {
    const length = Math.max(target.length, current.length);
    if (length === 0) {
      return {
        errorScore: 0,
        errorVector: {},
        weight: 1
      };
    }

    const comparisons = Array.from({ length }, (_, index) =>
      compareValue(target[index], current[index], `${path}[${index}]`)
    );
    const totalWeight = comparisons.reduce((sum, item) => sum + item.weight, 0);
    const weightedScore = comparisons.reduce(
      (sum, item) => sum + item.errorScore * item.weight,
      0
    );

    return {
      errorScore: totalWeight === 0 ? 0 : weightedScore / totalWeight,
      errorVector: mergeErrorVectors(comparisons.map((item) => item.errorVector)),
      weight: totalWeight
    };
  }

  if (isPlainObject(target) && isPlainObject(current)) {
    const keys = [...new Set([...Object.keys(target), ...Object.keys(current)])];
    if (keys.length === 0) {
      return {
        errorScore: 0,
        errorVector: {},
        weight: 1
      };
    }

    const comparisons = keys.map((key) =>
      compareValue(
        target[key],
        current[key],
        path ? `${path}.${key}` : key
      )
    );
    const totalWeight = comparisons.reduce((sum, item) => sum + item.weight, 0);
    const weightedScore = comparisons.reduce(
      (sum, item) => sum + item.errorScore * item.weight,
      0
    );

    return {
      errorScore: totalWeight === 0 ? 0 : weightedScore / totalWeight,
      errorVector: mergeErrorVectors(comparisons.map((item) => item.errorVector)),
      weight: totalWeight
    };
  }

  return {
    errorScore: 1,
    errorVector: path ? { [path]: 1 } : { root: 1 },
    weight: 1
  };
}

function hasAlternatingDeltas(
  history: number[],
  flatTolerance: number,
  oscillationAmplitude: number
): boolean {
  const amplitudes = Math.max(...history) - Math.min(...history);
  if (amplitudes < oscillationAmplitude) {
    return false;
  }

  const deltas = history
    .slice(1)
    .map((value, index) => value - (history[index] ?? value));
  if (deltas.some((delta) => Math.abs(delta) <= flatTolerance)) {
    return false;
  }

  return deltas.slice(1).every((delta, index) => {
    const previousDelta = deltas[index];
    return previousDelta !== undefined && Math.sign(delta) !== Math.sign(previousDelta);
  });
}

export function compareStructuredValues<TTarget, TCurrent>(
  target: TTarget,
  current: TCurrent
): Pick<ComparatorResult, "errorScore" | "errorVector"> {
  const comparison = compareValue(target, current, "");

  return {
    errorScore: Number(comparison.errorScore.toFixed(6)),
    errorVector: comparison.errorVector
  };
}

export function deriveErrorTrend(
  errorHistory: number[],
  options: ErrorTrendOptions = {}
): ErrorTrend {
  const mergedOptions = {
    ...DEFAULT_TREND_OPTIONS,
    ...options
  };

  if (errorHistory.length < 2) {
    return "flat";
  }

  const recentWindow = errorHistory.slice(-mergedOptions.oscillationWindow);
  if (
    recentWindow.length >= mergedOptions.oscillationWindow &&
    hasAlternatingDeltas(
      recentWindow,
      mergedOptions.flatTolerance,
      mergedOptions.oscillationAmplitude
    )
  ) {
    return "oscillating";
  }

  const previous = errorHistory[errorHistory.length - 2] ?? errorHistory[errorHistory.length - 1] ?? 0;
  const current = errorHistory[errorHistory.length - 1] ?? previous;
  const delta = current - previous;

  if (Math.abs(delta) <= mergedOptions.flatTolerance) {
    return "flat";
  }

  return delta < 0 ? "improving" : "degrading";
}

export function deterministicComparator<TTarget, TCurrent>(
  input: DeterministicComparatorInput<TTarget, TCurrent>
): ComparatorResult {
  const { errorScore, errorVector } = compareStructuredValues(input.target, input.current);
  const history = [
    ...(input.errorHistory ?? []),
    ...(input.previousErrorScore === undefined ? [] : [input.previousErrorScore]),
    errorScore
  ];
  const previousErrorScore =
    input.previousErrorScore ?? history[history.length - 2] ?? errorScore;

  return {
    errorVector,
    errorScore,
    deltaError: Number((errorScore - previousErrorScore).toFixed(6)),
    errorTrend: deriveErrorTrend(history),
    ...(errorScore === 0 ? { prediction: "State already matches target." } : {})
  };
}
