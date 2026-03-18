import { describe, expect, it } from "vitest";

import { runAeolusDemo } from "../../examples/aeolus/system";

describe("Aeolus example", () => {
  it("produces a converging preview path and a converging reality run", async () => {
    const result = await runAeolusDemo({ seed: "steady-breeze" });

    expect(result.report.visualization.goalZone.label).toBe("Goal zone");
    expect(result.report.visualization.goalZone.epsilon).toBe(0.08);
    expect(result.report.visualization.goalZone.successRadiusWorld).toBeGreaterThan(0);
    expect(result.runs.simulation.finalStatus).toBe("converged");
    expect(result.runs.reality.finalStatus).toBe("converged");
    expect(result.runs.simulation.steps.length).toBeGreaterThanOrEqual(20);
    expect(result.runs.simulation.steps.length).toBeLessThanOrEqual(30);
    expect(result.runs.reality.steps.length).toBeGreaterThanOrEqual(20);
    expect(result.runs.reality.steps.length).toBeLessThanOrEqual(30);
    expect(result.runs.simulation.steps[0]?.predictedPosition.x).toBeGreaterThan(0);
    expect(result.runs.simulation.steps[0]?.predictedPosition.y).toBeGreaterThan(0);
    expect(result.runs.simulation.previewPath).toHaveLength(result.runs.simulation.steps.length);
    expect(result.runs.reality.previewPath).toEqual(
      result.runs.simulation.steps.map((step) => step.actualPosition)
    );
    expect(
      result.runs.reality.steps.some((step) => step.disturbanceMagnitude > 0)
    ).toBe(true);
    expect(
      result.runs.reality.auditLog.every((row) => row.disturbanceDelta !== "n/a")
    ).toBe(true);
    expect(
      result.runs.reality.steps.some((step) => step.compactionToast !== undefined)
    ).toBe(true);
    expect(
      result.runs.reality.steps.some(
        (step) => step.diagnosticsCode === "DISTURBANCE_DETECTED"
      )
    ).toBe(true);
    expect(
      result.runs.reality.steps[result.runs.reality.steps.length - 1]?.diagnosticsCode
    ).toBeUndefined();
  });

  it("keeps simulation isolated from configured disturbance sequences", async () => {
    const result = await runAeolusDemo({
      seed: "steady-breeze",
      previewNoiseSequence: [
        { x: 5, y: 5 },
        { x: -5, y: -5 }
      ],
      realityNoiseSequence: [
        { x: 5, y: 5 },
        { x: -5, y: -5 }
      ]
    });

    expect(
      result.runs.simulation.steps.every(
        (step) =>
          step.noiseForce.x === 0 &&
          step.noiseForce.y === 0 &&
          step.actualPosition.x === step.predictedPosition.x &&
          step.actualPosition.y === step.predictedPosition.y
      )
    ).toBe(true);
    expect(
      result.runs.reality.steps.some(
        (step) => step.noiseForce.x !== 0 || step.noiseForce.y !== 0
      )
    ).toBe(true);
    expect(
      result.runs.reality.steps.every(
        (step) => Math.abs(step.noiseForce.x) <= 5 && Math.abs(step.noiseForce.y) <= 5
      )
    ).toBe(true);
    expect(result.runs.simulation.steps.length).toBeGreaterThanOrEqual(20);
  });

  it("interrupts with CRITICAL_DRIFT when disturbance exceeds control authority", async () => {
    const result = await runAeolusDemo({
      seed: "steady-breeze",
      initialPosition: { x: 96, y: 96 },
      realityNoiseSequence: [{ x: 5, y: 5 }]
    });

    expect(result.runs.reality.finalStatus).toBe("awaiting_human_intervention");
    expect(result.runs.reality.finalStopReason).toBe(
      "CRITICAL_DRIFT: External disturbance exceeds control authority"
    );
    expect(result.runs.reality.finalDiagnosticsCode).toBe("CRITICAL_DRIFT");
    expect(
      result.runs.reality.steps.some((step) => step.verifierAlert !== undefined)
    ).toBe(true);
  });
});
