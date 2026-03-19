import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeAeolusArtifacts } from "./artifacts";

async function main(): Promise<void> {
  const directory = dirname(fileURLToPath(import.meta.url));
  const { result, paths } = await writeAeolusArtifacts({
    outDirectory: join(directory, "out")
  });

  console.log(
    JSON.stringify(
      {
        generatedAt: result.report.generatedAt,
        simulation: {
          status: result.runs.simulation.finalStatus,
          stopReason: result.runs.simulation.finalStopReason,
          steps: result.runs.simulation.steps.length
        },
        reality: {
          status: result.runs.reality.finalStatus,
          stopReason: result.runs.reality.finalStopReason,
          steps: result.runs.reality.steps.length
        },
        artifacts: {
          html: paths.html,
          json: paths.json
        }
      },
      null,
      2
    )
  );
}

void main();
