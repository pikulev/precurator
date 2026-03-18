import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderAeolusDashboard } from "./report-template";
import { runAeolusDemo } from "./system";

async function main(): Promise<void> {
  const result = await runAeolusDemo();
  const directory = dirname(fileURLToPath(import.meta.url));
  const outDirectory = join(directory, "out");
  const htmlPath = join(outDirectory, "aeolus-dashboard.html");
  const jsonPath = join(outDirectory, "aeolus-report.json");

  await mkdir(outDirectory, { recursive: true });
  await writeFile(jsonPath, JSON.stringify(result.report, null, 2), "utf8");
  await writeFile(htmlPath, renderAeolusDashboard(result.report), "utf8");

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
          html: htmlPath,
          json: jsonPath
        }
      },
      null,
      2
    )
  );
}

void main();
