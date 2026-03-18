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

const system = compileControlSystem(
  {
    schemas: {
      target: z.object({ value: z.number() }),
      current: z.object({ value: z.number() })
    },
    stopPolicy: {
      // Останавливаемся, когда `errorScore <= epsilon` (детерминированный comparator по умолчанию)
      epsilon: 0,
      maxIterations: 10
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
        // Пауза (interrupt) один раз, чтобы показать resume-path.
        if (current.value === 4 && history.length === 1) {
          return {
            status: "awaiting_human_intervention",
            stopReason: "manual-review"
          };
        }

        return { status: "optimizing" };
      }
    }
  }
);

const interrupted = await system.invoke({
  target: { value: 10 },
  current: { value: 2 },
  metadata: { thread_id: "hello-world" }
});

const snapshot =
  interrupted.runtime.status === "awaiting_human_intervention"
    ? await system.resume(interrupted, {
        current: { value: 10 },
        humanDecision: {
          action: "resume",
          approvedBy: "operator"
        }
      })
    : interrupted;
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

## API Reference (contract-level)

### ControlBasis<TTarget, TCurrent>
- `target`: set point (`TTarget`)
- `current`: observed state (`TCurrent`)
- `worldContext`: `Record<string, unknown>` (опциональная "модель мира")
- `errorVector`: `Record<string, number | string | boolean | null>`
- `errorScore`: `number` в `[0, 1]` (чем меньше - тем ближе к цели)
- `deltaError`: изменение `errorScore` относительно предыдущего шага
- `errorTrend`: `"improving" | "flat" | "degrading" | "oscillating"`
- `shortTermMemory`: bounded window для регулятора
- `prediction`: опциональный прогноз (если comparator вернул `prediction`)

### RuntimeContext
- `k`: номер итерации
- `status`: `"optimizing" | "converged" | "stuck" | "failed" | "awaiting_human_intervention" | "aborted"`
- `stopReason`: причина остановки/паузы
- `diagnostics`: структурированная диагностика `stuck/failed/interrupt`
- `auditLogRef`: указатель на внешний audit trail
- `checkpointId`, `bestCheckpointId`: checkpoint-based time-travel метаданные
- `tokenBudgetUsed`: накопленный guard budget (если включен `maxTokenBudget`)
- `simulation`: флаг ветки simulation (инструменты блокируются в simulation)
- `metadata`, `humanDecision`: trace/human-in-the-loop контекст

### ControlSystemConfig<TTarget, TCurrent> (JSON-ready)
- `schemas?`: Zod-схемы для `target` и/или `current` (валидация входов и `resume`)
- `stopPolicy`: `{ epsilon, maxIterations, maxTokenBudget? }`
- `memory?`: bounded memory config (`maxShortTermSteps`, `compactionStrategy`, `summaryReplacementSemantics`)
- `mode?`: `"conservative" | "balanced" | "aggressive"`
- `observerRef?`, `verifierRef?`, `modelRef?`, `toolRefs?`, `metadata?`
- `comparatorRef?`: ссылка на comparator в `RuntimeRegistry` (каноничный JSON-ready путь)

### RuntimeRegistry (resolves refs)
- `observers`: `Record<string, ObserverHandler<TTarget, TCurrent>>`
- `verifiers`: `Record<string, VerifierHandler<TTarget, TCurrent>>`
- `comparators`: `Record<string, ComparatorHandler<TTarget, TCurrent>>`
- `tools`: `Record<string, ToolRegistration>`
- `tokenBudgetEstimator?`: оценщик budget'a (в связке с `maxTokenBudget`)
- `summarizeCompactedSteps?`: кастомный bounded-memory summarizer
- `checkpointer?`: LangGraph checkpoint backend
- `models?`: `Record<string, unknown>` (если используется `modelRef`)

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
