import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  target: "node20",
  external: ["@langchain/langgraph", "@langchain/core", "zod"]
});
