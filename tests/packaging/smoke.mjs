import { createRequire } from "node:module";
import { strict as assert } from "node:assert";

const esmModule = await import("../../dist/index.js");
const require = createRequire(import.meta.url);
const cjsModule = require("../../dist/index.cjs");

assert.equal(typeof esmModule.compileControlSystem, "function");
assert.equal(typeof cjsModule.compileControlSystem, "function");

assert.equal(typeof esmModule.DefaultSummarizer, "function");
assert.equal(typeof cjsModule.DefaultSummarizer, "function");
