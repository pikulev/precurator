import { z } from "zod";

import { compileControlSystem } from "../../src";

async function main(): Promise<void> {
  const system = compileControlSystem({
    schemas: {
      target: z.object({ value: z.number() }),
      current: z.object({ value: z.number() })
    },
    stopPolicy: {
      epsilon: 0.05,
      maxIterations: 3
    },
    memory: {
      maxShortTermSteps: 4,
      compactionStrategy: "summarize-oldest",
      summaryReplacementSemantics: "replace-compacted-steps"
    }
  });

  const snapshot = await system.invoke({
    target: { value: 5 },
    current: { value: 2 },
    metadata: {
      thread_id: "hello-world"
    }
  });

  console.log(
    JSON.stringify(
      {
        status: snapshot.runtime.status,
        errorScore: snapshot.control.errorScore,
        checkpointId: snapshot.runtime.checkpointId
      },
      null,
      2
    )
  );
}

void main();
