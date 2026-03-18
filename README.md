# `precurator`

`precurator` is a TypeScript library for building cybernetic control loops for AI agents on top of LangGraph. The repository is initialized as a Node-first, Bun-managed package with dual ESM/CJS output, strict public typings, and an agent-facing workflow contract.

## Requirements

- Node.js `>=20`
- Bun `>=1.2`

## Install

```bash
bun add precurator @langchain/core @langchain/langgraph zod
```

`@langchain/core`, `@langchain/langgraph`, and `zod` are declared as peer dependencies to avoid duplicate runtimes in consumer projects.

## One-Minute Guide

```ts
import { z } from "zod";
import { compileControlSystem } from "precurator";

const system = compileControlSystem({
  schemas: {
    target: z.object({ value: z.number() }),
    current: z.object({ value: z.number() })
  },
  stopPolicy: {
    epsilon: 0.05,
    maxIterations: 5
  },
  memory: {
    maxShortTermSteps: 4,
    compactionStrategy: "summarize-oldest",
    summaryReplacementSemantics: "replace-compacted-steps"
  }
});

const snapshot = await system.invoke({
  target: { value: 10 },
  current: { value: 7 }
});
```

The canonical entrypoint is `compileControlSystem(config)`. Runtime instances should stay outside config/state and be resolved through external registries.

## Deterministic Presets

For early TDD cycles and synthetic control tests, the package also exports deterministic helpers:

```ts
import { deriveErrorTrend, deterministicComparator } from "precurator";

const comparison = deterministicComparator({
  target: { value: 10 },
  current: { value: 7 },
  previousErrorScore: 0.5
});

const trend = deriveErrorTrend([0.5, 0.3, 0.4]);
```

This preset keeps `errorScore` normalized to `[0, 1]` for structured data and makes trend/oscillation logic testable without a live model.

## Development

```bash
bun install
bun run verify
```

## Repository Layout

- `src/` public contracts, runtime stubs, and bounded-memory helpers
- `tests/` unit, integration, type, and packaging checks
- `examples/hello-world/` minimal runnable scenario
- `docs/` ADRs, TDD plan, and publish-readiness criteria
- `.cursor/rules/` persistent guidance for coding agents
