# Agent Operating Contract

## Source Of Truth

- Architectural intent lives in `docs/ADR/ADR-001.md`, `docs/ADR/ADR-002.md`, and `docs/ADR/ADR-003.md`.
- Publish constraints live in `docs/PUBLISH-READINESS-CHECKLIST.md`.
- Testing priorities live in `docs/TDD-PLAN.md`.

## Hard Invariants

- Keep `ControlSystemConfig` JSON-ready. Runtime instances, SDK clients, closures, and tool handlers belong in registries, not in config or checkpointed state.
- Preserve the split between `control` and `runtime`. `runtime` metadata must not become the source of truth for domain state.
- Keep graph state serializable and checkpointer-safe. Do not introduce classes, promises, or hidden mutable state into exported contracts.
- Treat bounded memory as a first-class contract. Prompt-facing history must remain finite and auditable.
- Treat `simulation` as a hard safety boundary. No destructive side effects in simulation branches.

## Workflow Rules

- When changing public TypeScript contracts, update tests and the relevant ADR/checklist docs in the same change.
- Keep dual-package compatibility intact: ESM, CJS, and typings must continue to resolve from `exports`.
- Prefer deterministic helpers and explicit guards over hidden heuristics.
