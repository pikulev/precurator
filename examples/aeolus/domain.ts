export interface AeolusVector {
  x: number;
  y: number;
}

export interface AeolusTarget {
  target: AeolusVector;
  fieldMin: number;
  fieldMax: number;
}

export interface AeolusCurrent {
  position: AeolusVector;
  controlForce: AeolusVector;
  noiseForce: AeolusVector;
  predictedPosition: AeolusVector;
  disturbanceDelta: AeolusVector;
  disturbanceMagnitude: number;
  controllerGain: number;
  controlAuthority: number;
  lastDistanceToTarget: number;
  reasoningTrace: string;
}

export interface AeolusStepInput {
  target: AeolusTarget;
  current: AeolusCurrent;
  simulation: boolean;
  rng: () => number;
  noiseForce?: AeolusVector;
}

export interface AeolusStepResult {
  nextCurrent: AeolusCurrent;
  verifierAlert?: string;
  criticalDrift?: {
    code: "CRITICAL_DRIFT";
    message: "External disturbance exceeds control authority";
    evidence: Record<string, unknown>;
  };
}

const ROUND_PRECISION = 1000;
const MIN_CONTROLLER_GAIN = 0.45;
const MAX_CONTROLLER_GAIN = 1.25;
const BASE_CONTROL_AUTHORITY = 5;
const GAIN_CONTROL_FACTOR = 3;
const DISTURBANCE_ALERT_THRESHOLD = 5.6;

function round(value: number): number {
  return Math.round(value * ROUND_PRECISION) / ROUND_PRECISION;
}

export function roundVector(vector: AeolusVector): AeolusVector {
  return {
    x: round(vector.x),
    y: round(vector.y)
  };
}

export function addVectors(a: AeolusVector, b: AeolusVector): AeolusVector {
  return roundVector({
    x: a.x + b.x,
    y: a.y + b.y
  });
}

export function subtractVectors(a: AeolusVector, b: AeolusVector): AeolusVector {
  return roundVector({
    x: a.x - b.x,
    y: a.y - b.y
  });
}

export function vectorMagnitude(vector: AeolusVector): number {
  return round(Math.hypot(vector.x, vector.y));
}

function normalizeVector(vector: AeolusVector): AeolusVector {
  const magnitude = vectorMagnitude(vector);
  if (magnitude === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude
  };
}

function scaleVector(vector: AeolusVector, scale: number): AeolusVector {
  return roundVector({
    x: vector.x * scale,
    y: vector.y * scale
  });
}

export function limitVector(vector: AeolusVector, maxMagnitude: number): AeolusVector {
  const magnitude = vectorMagnitude(vector);
  if (magnitude <= maxMagnitude || magnitude === 0) {
    return roundVector(vector);
  }

  const normalized = normalizeVector(vector);
  return scaleVector(normalized, maxMagnitude);
}

export function distanceToTarget(position: AeolusVector, target: AeolusTarget): number {
  return vectorMagnitude(subtractVectors(target.target, position));
}

export function maxFieldDistance(target: AeolusTarget): number {
  return vectorMagnitude({
    x: target.target.x - target.fieldMin,
    y: target.target.y - target.fieldMin
  });
}

export function errorScoreForPosition(position: AeolusVector, target: AeolusTarget): number {
  const maxDistance = maxFieldDistance(target);
  if (maxDistance === 0) {
    return 0;
  }

  return round(distanceToTarget(position, target) / maxDistance);
}

export function createSeededRng(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function sampleNoiseForce(rng: () => number): AeolusVector {
  return roundVector({
    x: rng() * 10 - 5,
    y: rng() * 10 - 5
  });
}

export function formatVector(vector: AeolusVector): string {
  return `(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)})`;
}

export function formatDisturbanceDelta(vector: AeolusVector): string {
  const x = vector.x >= 0 ? `+${vector.x.toFixed(2)}` : vector.x.toFixed(2);
  const y = vector.y >= 0 ? `+${vector.y.toFixed(2)}` : vector.y.toFixed(2);
  return `${x}, ${y}`;
}

function nextControllerGain(input: {
  current: AeolusCurrent;
  nextDistance: number;
  disturbanceMagnitude: number;
}): number {
  const { current, nextDistance, disturbanceMagnitude } = input;
  const improvement = current.lastDistanceToTarget - nextDistance;
  const strongHeadwind = disturbanceMagnitude >= 4.4;
  const weakProgress = improvement < 0.6;

  if (strongHeadwind || weakProgress) {
    return round(Math.min(current.controllerGain + 0.05, MAX_CONTROLLER_GAIN));
  }

  if (improvement > 3.8 && disturbanceMagnitude < 1.2) {
    return round(Math.max(current.controllerGain - 0.015, MIN_CONTROLLER_GAIN));
  }

  return round(current.controllerGain);
}

export function computeControlForce(input: {
  position: AeolusVector;
  target: AeolusTarget;
  controllerGain: number;
}): {
  controlForce: AeolusVector;
  controlAuthority: number;
} {
  const errorVector = subtractVectors(input.target.target, input.position);
  const distance = vectorMagnitude(errorVector);
  const controlAuthority = round(
    BASE_CONTROL_AUTHORITY + input.controllerGain * GAIN_CONTROL_FACTOR
  );
  const requestedMagnitude = Math.min(distance * 0.11, controlAuthority);
  const controlForce = limitVector(
    scaleVector(normalizeVector(errorVector), requestedMagnitude),
    controlAuthority
  );

  return {
    controlForce,
    controlAuthority
  };
}

export function createInitialCurrent(position: AeolusVector, target: AeolusTarget): AeolusCurrent {
  return {
    position: roundVector(position),
    controlForce: { x: 0, y: 0 },
    noiseForce: { x: 0, y: 0 },
    predictedPosition: roundVector(position),
    disturbanceDelta: { x: 0, y: 0 },
    disturbanceMagnitude: 0,
    controllerGain: 0.75,
    controlAuthority: round(BASE_CONTROL_AUTHORITY + 0.75 * GAIN_CONTROL_FACTOR),
    lastDistanceToTarget: distanceToTarget(position, target),
    reasoningTrace:
      "Bootstrap state. Waiting for the first observation to estimate headwind and choose a conservative gain."
  };
}

export function simulateAeolusStep(input: AeolusStepInput): AeolusStepResult {
  const { controlForce, controlAuthority } = computeControlForce({
    position: input.current.position,
    target: input.target,
    controllerGain: input.current.controllerGain
  });
  const predictedPosition = addVectors(input.current.position, controlForce);
  const noiseForce = input.simulation
    ? { x: 0, y: 0 }
    : input.noiseForce ?? sampleNoiseForce(input.rng);
  const actualPosition = addVectors(predictedPosition, noiseForce);
  const disturbanceDelta = subtractVectors(actualPosition, predictedPosition);
  const disturbanceMagnitude = vectorMagnitude(disturbanceDelta);
  const nextDistance = distanceToTarget(actualPosition, input.target);
  const nextGain = nextControllerGain({
    current: input.current,
    nextDistance,
    disturbanceMagnitude
  });
  const verifierAlert =
    disturbanceMagnitude >= DISTURBANCE_ALERT_THRESHOLD
      ? "Disturbance Detected: Verifier corrective action triggered."
      : undefined;

  const reasoningTrace = input.simulation
    ? [
        "Simulation branch: Chaotic Turbine disabled.",
        `Planned control ${formatVector(controlForce)} with authority ${controlAuthority.toFixed(2)}.`,
        `Expected next position ${formatVector(predictedPosition)}.`
      ].join(" ")
    : [
        `Observed external disturbance ${formatVector(noiseForce)}.`,
        `Maintaining conservative gain ${input.current.controllerGain.toFixed(2)} -> ${nextGain.toFixed(2)}.`,
        `Predicted ${formatVector(predictedPosition)} but landed at ${formatVector(actualPosition)}.`
      ].join(" ");

  const nextCurrent: AeolusCurrent = {
    position: actualPosition,
    controlForce,
    noiseForce,
    predictedPosition,
    disturbanceDelta,
    disturbanceMagnitude,
    controllerGain: nextGain,
    controlAuthority,
    lastDistanceToTarget: nextDistance,
    reasoningTrace
  };

  if (isOutsideField(actualPosition, input.target)) {
    return {
      nextCurrent,
      ...(verifierAlert ? { verifierAlert } : {}),
      criticalDrift: {
        code: "CRITICAL_DRIFT",
        message: "External disturbance exceeds control authority",
        evidence: {
          fieldMin: input.target.fieldMin,
          fieldMax: input.target.fieldMax,
          actualPosition,
          predictedPosition,
          disturbanceDelta,
          disturbanceMagnitude,
          controlForce,
          controlAuthority
        }
      }
    };
  }

  return {
    nextCurrent,
    ...(verifierAlert ? { verifierAlert } : {})
  };
}

export function isOutsideField(position: AeolusVector, target: AeolusTarget): boolean {
  return (
    position.x < target.fieldMin ||
    position.y < target.fieldMin ||
    position.x > target.fieldMax ||
    position.y > target.fieldMax
  );
}
