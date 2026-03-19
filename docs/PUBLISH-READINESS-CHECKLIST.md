# Publish Readiness Checklist для `precurator`

Этот документ фиксирует критерии готовности `precurator` к публикации как публичного npm-пакета. Это не roadmap реализации и не marketing checklist, а архитектурный и продуктовый gate перед `npm publish`.

Связанные документы:

- `docs/ADR/ADR-001.md`
- `docs/ADR/ADR-002.md`
- `docs/ADR/ADR-003.md`

---

## 1. Data & Contract

Цель: библиотека остается предсказуемым инструментом, а не "магическим" runtime-объектом.

- [x] Полная типизация generics. Пользовательские `TTarget` и `TCurrent` проходят через `Evolve`, `Comparator`, `Verifier` и `ControlState` без деградации в `any`.
- [x] Сериализуемость конфигурации. `ControlSystemConfig` JSON-ready на уровне “refs” (например, `evolveRef`, `verifierRef`, `comparatorRef`, `toolRefs`); runtime instances подключаются через ссылки и реестры, а не через встраивание executable-функций в config. (Zod-схемы используются как валидаторы и не предназначены для JSON-строчного хранения.)
- [x] Runtime validation через схемы. `target/current` валидируются до входа в контрольный цикл; выход сенсора валидируется схемой `schemas.current` и отклоняется в `failed` со структурированной диагностикой.
- [x] Жесткий контракт кибернетического базиса. Пользовательский узел получает предсказуемые `control` и `runtime` из публичного контракта; runtime не подменяет domain state.
- [x] Checkpointer-safe state. Перед записью в checkpoint валидируются JSON-ready границы: `invoke` input, `evolve` output, результаты `comparator/verifier`, а также payload для `interrupt/resume`.

## 2. LangGraph Integration

Цель: библиотека бесшовно встраивается в экосистему LangGraph/LangChain без конфликтов и скрытых ограничений.

- [x] Совместимость с checkpointers. Корректность проверена на `MemorySaver` (LangGraph checkpoint lifecycle); `SqliteSaver/PostgresSaver` не покрыты smoke-тестами в CI.
- [x] Поддержка interrupts. `interrupt`/`resume`/`abort` сохраняют `runtime.k`, `checkpointId` и управляющий контекст; проверено в integration-тестах.
- [ ] Интеграция с LangSmith. Присутствует библиотечная telemetry-эвентность (`step:completed`, `step:interrupted`), но прямые LangSmith tags/metadata спаны не внедрены в текущей реализации.
- [x] Peer dependencies. `langgraph` и `@langchain/core` вынесены в `peerDependencies` (см. `package.json`), чтобы не форсировать конфликтующие копии.
- [x] Studio-friendly compiled graph. `compileControlSystem(config)` возвращает объект с `graph/getState`, пригодный для инспекции в LangGraph Studio.

## 3. Stability & Control

Цель: библиотека демонстрирует управляемое и устойчивое поведение на длинных итеративных сериях.

- [x] Bounded memory. Реализованы bounded-memory стратегии (`sliding-window`, `summarize-oldest`, `hybrid`) через явный контракт `shortTermMemory`; рост prompt-facing history ограничен.
- [x] Memory compaction contract. `shortTermMemory/summary` и trigger compaction описаны типами и реализованы детерминированно/тестируемо.
- [x] Stop-loss guards. `epsilon`, `maxIterations` и `maxTokenBudget` срабатывают детерминированно; при `maxTokenBudget` snapshot отражает `runtime.tokenBudgetUsed`.
- [x] Simulation mode isolation. В `simulation:true` destructive tools блокируются, а симуляционные checkpoints/audit отделены через `thread_id` и `auditLogRef`.
- [x] Error trend logic. `improving/flat/degrading/oscillating` вычисляются чистыми функциями и покрыты тестами; дополнительные guard-ветки (например, `no-progress`) также покрыты.
- [x] Human-in-the-loop semantics. `interrupt`, `resume`, `abort` и `humanDecision` формализованы и согласованы с checkpoint lifecycle; проверено интеграционными тестами.

## 4. Developer Experience

Цель: публичная библиотека проста в установке, запуске и понимании.

- [x] Чистая установка. У пакета нет `dependencies` поверх `peerDependencies`; тяжелые runtime-пакеты не бандлятся (см. `tsup.config.ts`/`package.json`).
- [x] One-minute guide. В `README.md` обновлен сценарий, показывающий `thread_id` и базовый `invoke -> resume` путь.
- [x] API reference. `README.md` содержит contract-level reference для `ControlBasis`, `RuntimeContext`, `ControlSystemConfig` и `RuntimeRegistry`, включая bounded-memory инварианты.
- [x] Набор пресетов. Есть хотя бы `deterministicComparator` как baseline `Comparator` и `DefaultSummarizer`, пригодные для старта без полной кастомной реализации.
- [x] Dual package support. Дистрибутив собран для ESM и CommonJS; smoke-тест проверяет оба модуля (`tests/packaging/smoke.mjs`).

## 5. Testing & Quality

Цель: готовность к публикации подтверждается не только архитектурой, но и проверяемостью поведения.

- [x] Unit tests. Покрыты deterministic comparator, trend/guards, bounded memory compaction и runtime assertions/валидаторы.
- [x] Integration tests with mocks. Покрыт полный control loop на mock evolvers/verifiers/tools, включая `interrupt/resume/abort` и бюджет токенов.
- [x] Synthetic trend tests. Покрыты синтетические последовательности для `degrading` и `oscillating` (без LLM).
- [x] E2E example. В `examples/hello-world/` есть runnable сценарий; CI не исполняет его, поэтому остаётся “промежуточное доверие” (но сценарий соответствует public контрактам).
- [x] Packaging verification. Проверены `tsup` сборка, импорты и smoke-test для ESM/CJS.
- [x] Publish gate review. Gate пройден на основании результата `bun run verify`; оставленные open-exceptions зафиксированы ниже (LangSmith tags, непокрытые checkpointers бэкенды и неисполняемый `examples` в CI).

---

## Ship It Criterion

`precurator` можно считать готовым к публикации, если разработчик может:

1. Описать задачу как JSON-ready `ControlSystemConfig`.
2. Передать конфиг в `compileControlSystem(config)`.
3. Получить предсказуемый LangGraph-объект c `graph`/`getState`, визуализируемый в Studio.
4. Запустить control loop, который корректно сходится или детерминированно останавливается по guard policy.
5. Не управлять памятью, interrupts и token-budget вручную вне контрактов библиотеки.

Если `ADR-003` реализован не только документально, но и как тестируемый bounded memory contract, библиотека приближается к состоянию `ship-ready` для `npm publish`.
