import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { renderAeolusDashboard } from "./report-template";
import {
  runAeolusDemo,
  type AeolusDemoOptions,
  type AeolusDemoResult
} from "./system";

export interface AeolusArtifactOutputOptions {
  outDirectory: string;
  htmlFilename?: string;
  jsonFilename?: string;
  demoOptions?: AeolusDemoOptions;
}

export interface AeolusArtifactPaths {
  directory: string;
  html: string;
  json: string;
}

export async function writeAeolusArtifacts(
  options: AeolusArtifactOutputOptions
): Promise<{
  result: AeolusDemoResult;
  paths: AeolusArtifactPaths;
}> {
  const result = await runAeolusDemo(options.demoOptions);
  const htmlFilename = options.htmlFilename ?? "aeolus-dashboard.html";
  const jsonFilename = options.jsonFilename ?? "aeolus-report.json";
  const htmlPath = join(options.outDirectory, htmlFilename);
  const jsonPath = join(options.outDirectory, jsonFilename);

  await mkdir(options.outDirectory, { recursive: true });
  await writeFile(jsonPath, JSON.stringify(result.report, null, 2), "utf8");
  await writeFile(htmlPath, renderAeolusDashboard(result.report), "utf8");

  return {
    result,
    paths: {
      directory: options.outDirectory,
      html: htmlPath,
      json: jsonPath
    }
  };
}
