import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeAeolusArtifacts } from "../examples/aeolus/artifacts";

async function main(): Promise<void> {
  const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
  const outDirectory = join(rootDirectory, "out", "aeolus-pages");
  const { result, paths } = await writeAeolusArtifacts({
    outDirectory,
    htmlFilename: "index.html"
  });

  await writeFile(join(outDirectory, ".nojekyll"), "", "utf8");

  console.log(
    JSON.stringify(
      {
        generatedAt: result.report.generatedAt,
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
