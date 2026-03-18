export class SimulationSecurityError extends Error {
  constructor(toolRef: string) {
    super(`Tool "${toolRef}" is blocked in simulation mode.`);
    this.name = "SimulationSecurityError";
  }
}

export class PrecuratorValidationError extends Error {
  override readonly name = "PrecuratorValidationError";

  /**
   * ZodError's `.issues` (or any other validation payload) captured for debugging.
   * Kept as `unknown` to avoid coupling to Zod's internal structure.
   */
  public readonly evidence?: unknown;

  constructor(message: string, evidence?: unknown) {
    super(message);
    if (evidence !== undefined) {
      this.evidence = evidence;
    }
  }
}

export class NonSerializableDataError extends Error {
  override readonly name = "NonSerializableDataError";

  /** A compact hint about what broke the serialization contract. */
  public readonly evidence?: Record<string, unknown>;

  constructor(message: string, evidence?: Record<string, unknown>) {
    super(message);
    if (evidence !== undefined) {
      this.evidence = evidence;
    }
  }
}
