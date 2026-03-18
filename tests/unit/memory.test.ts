import { describe, expect, it } from "vitest";

import { compactShortTermMemory, createMemoryStep } from "../../src";

describe("compactShortTermMemory", () => {
  it("keeps the latest K steps for sliding-window", async () => {
    const history = [1, 2, 3].map((step) =>
      createMemoryStep({
        kind: "comparison",
        message: `step-${step}`
      })
    );

    const memory = await compactShortTermMemory(history, {
      maxShortTermSteps: 2,
      strategy: "sliding-window",
      semantics: "replace-compacted-steps",
      auditLogRef: "audit-1"
    });

    expect(memory.steps.map((step) => step.message)).toEqual(["step-2", "step-3"]);
    expect(memory.summary).toBeUndefined();
  });

  it("creates a deterministic summary for summarize-oldest", async () => {
    const history = [1, 2, 3].map((step) =>
      createMemoryStep({
        kind: "comparison",
        message: `step-${step}`
      })
    );

    const memory = await compactShortTermMemory(history, {
      maxShortTermSteps: 1,
      strategy: "summarize-oldest",
      semantics: "replace-compacted-steps",
      auditLogRef: "audit-2"
    });

    expect(memory.steps).toHaveLength(1);
    expect(memory.summary).toContain("Compacted 2 step(s)");
    expect(memory.summary).toContain("audit-2");
  });
});
