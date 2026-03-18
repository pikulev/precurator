export class SimulationSecurityError extends Error {
  constructor(toolRef: string) {
    super(`Tool "${toolRef}" is blocked in simulation mode.`);
    this.name = "SimulationSecurityError";
  }
}
