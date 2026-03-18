import { z } from "zod";

import { compileControlSystem } from "../../src";

async function main(): Promise<void> {
  const system = compileControlSystem(
    {
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
      },
      observerRef: "increment-observer",
      verifierRef: "pause-once-verifier"
    },
    {
      observers: {
        "increment-observer": ({ current, target }) => ({
          value: Math.min(current.value + 2, target.value)
        })
      },
      verifiers: {
        "pause-once-verifier": ({ current, history }) => {
          if (current.value === 4 && history.length === 1) {
            return {
              status: "awaiting_human_intervention" as const,
              stopReason: "manual-review"
            };
          }

          return {
            status: "optimizing" as const
          };
        }
      }
    }
  );

  const interrupted = await system.invoke({
    target: { value: 50 },
    current: { value: 2 },
    metadata: {
      thread_id: "hello-world"
    }
  });
  const snapshot =
    interrupted.runtime.status === "awaiting_human_intervention"
      ? await system.resume(interrupted, {
          current: { value: 5 },
          humanDecision: {
            action: "resume",
            approvedBy: "operator"
          }
        })
      : interrupted;

  console.log(
    JSON.stringify(
      {
        status: snapshot.runtime.status,
        errorScore: snapshot.control.errorScore,
        checkpointId: snapshot.runtime.checkpointId,
        bestCheckpointId: snapshot.runtime.bestCheckpointId,
        iterations: snapshot.runtime.k + 1,
        threadConfig: system.getThreadConfig({
          threadId: "hello-world"
        })
      },
      null,
      2
    )
  );
}

void main();
