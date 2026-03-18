# EXAMPLE: Aeolus Dashboard

`Aeolus` is a flagship `precurator` example for Phase 2 "Turbulence". It demonstrates how the library keeps a cybernetic loop stable when an external disturbance keeps injecting noise into the plant.

## What This Example Demonstrates

- disturbance detection through a verifier that compares expected motion against observed motion;
- conservative gain control that increases authority gradually instead of panicking to max power;
- bounded-memory compaction with visible toast notifications for summarized history;
- `simulation: true` as an isolated preview branch with the Chaotic Turbine disabled;
- long-horizon convergence across roughly `20-30` real control iterations;
- autonomous report generation as a self-contained HTML dashboard plus machine-readable JSON.

## Domain Model

The example treats the field as a 2D plant with a target and a ball:

- `AeolusTarget`
  - `target`: desired position, by default `(100, 100)`
  - `fieldMin`: lower field boundary, by default `0`
  - `fieldMax`: upper field boundary, by default `100`
- initial ball position: by default `(0, 0)`
- `AeolusCurrent`
  - `position`: observed ball position after control and disturbance
  - `controlForce`: green control vector applied by the controller
  - `noiseForce`: red disturbance vector produced by the Chaotic Turbine
  - `predictedPosition`: ghost position expected without external noise
  - `disturbanceDelta`: difference between expected and actual position
  - `disturbanceMagnitude`: scalar disturbance strength
  - `controllerGain`: conservative gain scheduler state
  - `controlAuthority`: current maximum control authority
  - `lastDistanceToTarget`: previous step distance used for gain adaptation
  - `reasoningTrace`: text trace used in the dashboard

All fields remain JSON-serializable. Runtime instances, RNG state and report collectors stay in closures and registries, not in `ControlSystemConfig` or checkpointed state.

## Mapping To Current `precurator` API

The example intentionally does not add a new public `Predictor` node. It stays inside the current control loop:

- `observerRef`
  - advances the plant one step forward;
  - applies the current control vector;
  - injects `noiseForce` in reality mode;
  - disables disturbance in `simulation: true`;
  - stores `predictedPosition`, `disturbanceDelta` and `reasoningTrace` in the observed state.
- `comparatorRef`
  - computes `errorVector`, normalized `errorScore`, `deltaError` and `errorTrend`;
  - mirrors predictor intent into `ComparatorResult.prediction`, so the control loop still exposes a prediction contract.
- `verifierRef`
  - raises `DISTURBANCE_DETECTED` diagnostics when expected and actual motion diverge sharply;
  - triggers `awaiting_human_intervention` with `CRITICAL_DRIFT: External disturbance exceeds control authority` when the ball exits the field.
- telemetry hooks
  - `step:completed` and `step:interrupted` are used to assemble the dashboard dataset outside prompt-facing state.

This keeps the example aligned with `observe -> compare -> verify -> compactMemory` and preserves the `control` / `runtime` split.

## Simulation vs Reality

The example always runs two branches from the same initial condition:

1. `simulation: true`
   - the Chaotic Turbine is disabled;
   - the controller now converges over a longer horizon of roughly `20-30` real steps;
   - the resulting path becomes the dotted preview trajectory in the dashboard.
2. reality
   - the same control logic runs again;
   - the observer samples disturbance in `[-5, +5]` per axis;
   - the controller remains intentionally conservative so the trajectory unfolds over roughly `20-30` steps instead of snapping to the target in a handful of moves;
   - the dashboard renders the drift between predicted and actual motion.

This side-by-side contrast is the core product story: planning in an ideal world, then correcting in a turbulent world without breaking safety invariants.

## Audit Log Contract

The generated report includes an audit table with the required `Disturbance Delta` column. Each row captures:

- step index;
- disturbance delta;
- expected position;
- actual position;
- error score;
- delta error;
- error trend.

The same data is also stored in `examples/aeolus/out/aeolus-report.json`.

## Memory Compaction Signal

The example keeps bounded memory enabled:

- `maxShortTermSteps: 4`
- `compactionStrategy: "summarize-oldest"`
- `summaryReplacementSemantics: "replace-compacted-steps"`

When compaction occurs, the custom summarizer emits a dashboard toast in the form:

`Step 1-4 compacted into Summary. Context optimized.`

The compacted summary stays serializable and remains linked to `runtime.auditLogRef`.

## Safety Guard

If disturbance pushes the ball outside the field bounds, the verifier returns:

- `status: "awaiting_human_intervention"`
- `stopReason: "CRITICAL_DRIFT: External disturbance exceeds control authority"`
- diagnostics code `CRITICAL_DRIFT`

This is the explicit safety boundary for the example and demonstrates that external turbulence can be escalated as a structured interrupt instead of a silent failure.

## Generated Artifacts

Running the example creates:

- `examples/aeolus/out/aeolus-dashboard.html`
- `examples/aeolus/out/aeolus-report.json`

The HTML report is self-contained and uses only embedded CSS, SVG and vanilla JavaScript.

## How To Run

From the repository root:

```bash
bun examples/aeolus/index.ts
```

The command prints a small JSON summary with the final statuses and the artifact paths.

## Implementation Notes

- The report collector lives outside `ControlState` so that checkpoints remain serializable.
- The example uses a seeded RNG for reproducible dashboards and stable tests.
- The default demo starts from `(0, 0)` to emphasize long-horizon convergence from the corner of the field.
- The default horizon is tuned for roughly `20-30` real control iterations so the dashboard animation stays smooth without faking intermediate states.
- `simulation: true` still follows the same control loop, but `noiseForce` is forced to zero.
- The demo is designed to illustrate library behavior, not to hide domain logic in a black box.
