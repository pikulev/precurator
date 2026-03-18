# Publish Readiness Checklist для `precurator`

Этот документ фиксирует критерии готовности `precurator` к публикации как публичного npm-пакета. Это не roadmap реализации и не marketing checklist, а архитектурный и продуктовый gate перед `npm publish`.

Связанные документы:

- `docs/ADR/ADR-001.md`
- `docs/ADR/ADR-002.md`
- `docs/ADR/ADR-003.md`

---

## 1. Data & Contract

Цель: библиотека остается предсказуемым инструментом, а не "магическим" runtime-объектом.

- [ ] Полная типизация generics. Пользовательские `TTarget` и `TCurrent` проходят через `Observer`, `Comparator`, `Predictor`, `Verifier` и `ControlState` без деградации в `any`.
- [ ] Сериализуемость конфигурации. `ControlSystemConfig` представим как чистый JSON-ready объект; runtime instances подключаются через ссылки и реестры, а не через встраивание в config.
- [ ] Runtime validation через схемы. Библиотека экспортирует и использует валидаторы для `target`, `current` и базового control state; некорректный `current` отклоняется до LLM/tool execution.
- [ ] Жесткий контракт кибернетического базиса. Пользовательский узел гарантированно получает предсказуемые `control` и `runtime`, без скрытых обязательных полей вне публичного контракта.
- [ ] Checkpointer-safe state. В graph state нет classes, closures, model instances, SDK clients и иных несериализуемых объектов.

## 2. LangGraph Integration

Цель: библиотека бесшовно встраивается в экосистему LangGraph/LangChain без конфликтов и скрытых ограничений.

- [ ] Совместимость с checkpointers. Состояние корректно сохраняется и восстанавливается через `SqliteSaver`, `PostgresSaver` или эквивалентный checkpointer backend.
- [ ] Поддержка interrupts. `interrupt_before` и `interrupt_after` работают штатно; `resume` не теряет `runtime.k`, `checkpoint_id` и контекст управления.
- [ ] Интеграция с LangSmith. Внутренние шаги размечаются тегами и metadata: как минимум `control_step_type`, `error_score`, `delta_error`, `error_trend`, `simulation`, `checkpoint_id`.
- [ ] Peer dependencies. `langgraph` и `@langchain/core` вынесены в `peerDependencies`, чтобы не форсировать конфликтующие копии пакетов.
- [ ] Studio-friendly compiled graph. `compileControlSystem(config)` отдает объект, который можно инспектировать и визуализировать в LangGraph Studio без ручной пересборки hidden runtime-слоев.

## 3. Stability & Control

Цель: библиотека демонстрирует управляемое и устойчивое поведение на длинных итеративных сериях.

- [ ] Bounded memory. Реализована и задокументирована хотя бы одна стратегия компакции памяти; prompt-facing history не растет бесконечно.
- [ ] Memory compaction contract. `shortTermMemory`, `summary` и trigger compaction оформлены как явный контракт, а не внутренняя эвристика.
- [ ] Stop-loss guards. `epsilon`, `maxIterations` и `maxTokenBudget` срабатывают детерминированно и документированы как обязательные предохранители.
- [ ] Simulation mode isolation. При `simulation: true` destructive tools блокируются или переводятся в dry-run/mock, а `best_checkpoint_id` и боевой audit trail не загрязняются.
- [ ] Error trend logic. Выявление `improving`, `flat`, `degrading`, `oscillating` определено как тестируемая логика, а не как неформальное впечатление LLM.
- [ ] Human-in-the-loop semantics. `interrupt`, `resume`, `abort` и `humanDecision` формализованы и совместимы с checkpoint lifecycle.

## 4. Developer Experience

Цель: публичная библиотека проста в установке, запуске и понимании.

- [ ] Чистая установка. `npm install precurator` не тянет неявные тяжелые зависимости, не обязательные для core-runtime.
- [ ] One-minute guide. Есть минимальный "Hello World" сценарий, который показывает `compileControlSystem(config)` и базовый invoke-path без сложного доменного окружения.
- [ ] API reference. Документированы `ControlBasis`, `RuntimeContext`, `ControlSystemConfig`, runtime registry contracts и invariants bounded memory.
- [ ] Набор пресетов. Есть хотя бы `DefaultComparator` и `DefaultSummarizer`, пригодные для старта без полной кастомной реализации.
- [ ] Dual package support. Пакет собран в ESM и CommonJS-совместимом формате, если целевая аудитория включает смешанные Node.js-окружения.

## 5. Testing & Quality

Цель: готовность к публикации подтверждается не только архитектурой, но и проверяемостью поведения.

- [ ] Unit tests. Логика `Comparator`, reducers и memory compaction покрыта unit-тестами на пограничных случаях.
- [ ] Integration tests with mocks. Есть тесты control loop с `FakeLLM`/mock tools, проверяющие переходы между состояниями при разных значениях ошибки.
- [ ] Synthetic trend tests. Логика `degrading`/`oscillating` проверяется на синтетических последовательностях без обращения к реальной LLM.
- [ ] E2E example. В `examples` есть хотя бы один полноценный runnable сценарий, подтверждающий рабочий путь библиотеки.
- [ ] Packaging verification. Проверена сборка, импорты и базовый smoke-test для обоих модулей экспорта.
- [ ] Publish gate review. Перед публикацией выполнен проход по этому checklist и зафиксированы открытые исключения, если какие-либо критерии сознательно не выполнены.

---

## Ship It Criterion

`precurator` можно считать готовым к публикации, если разработчик может:

1. Описать задачу как JSON-ready `ControlSystemConfig`.
2. Передать конфиг в `compileControlSystem(config)`.
3. Получить предсказуемый LangGraph-объект, визуализируемый в Studio.
4. Запустить control loop, который корректно сходится или детерминированно останавливается по guard policy.
5. Не управлять памятью, interrupts и token-budget вручную вне контрактов библиотеки.

Если `ADR-003` реализован не только документально, но и как тестируемый bounded memory contract, библиотека приближается к состоянию `ship-ready` для `npm publish`.
