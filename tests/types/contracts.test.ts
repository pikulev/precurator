import { expectTypeOf } from "expect-type";
import { z } from "zod";

import type {
  ControlState,
  ObserverHandler,
  RuntimeContext,
  RuntimeExecutionContext,
  ToolRegistration,
  VerifierHandler
} from "../../src";
import { compileControlSystem } from "../../src";

interface TargetState {
  goal: string;
}

interface CurrentState {
  goal: string;
}

const system = compileControlSystem<TargetState, CurrentState>({
  stopPolicy: {
    epsilon: 0.05,
    maxIterations: 3
  }
});

expectTypeOf(system.config.stopPolicy.maxIterations).toEqualTypeOf<number>();
expectTypeOf(system.abort).toBeFunction();
expectTypeOf(system.graph.getState).toBeFunction();
expectTypeOf(system.getState).toBeFunction();
expectTypeOf(system.getThreadConfig).toBeFunction();
expectTypeOf(system.on).toBeFunction();

system.on("step:completed", (payload) => {
  void payload.error_score;
  void payload.delta_error;
  void payload.error_trend;
  void payload.simulation;
  void payload.checkpoint_id;
  void payload.thread_id;
});

system.on("step:interrupted", (payload) => {
  void payload.human_intervention_reason;
  void payload.stop_reason;
  void payload.checkpoint_id;
});

const systemWithBudget = compileControlSystem<TargetState, CurrentState>({
  stopPolicy: {
    epsilon: 0.05,
    maxIterations: 3,
    maxTokenBudget: 12
  }
}, {
  tokenBudgetEstimator: ({ target, current, executionContext }) => {
    const nextGoal: string = target.goal;
    const currentGoal: string = current.goal;
    const iteration: number = executionContext.k;

    void nextGoal;
    void currentGoal;
    void iteration;
    return 1;
  }
});

expectTypeOf(systemWithBudget.config.stopPolicy.maxTokenBudget).toEqualTypeOf<number | undefined>();

type Snapshot = ControlState<TargetState, CurrentState>;

const snapshot = {
  runtime: {} as RuntimeContext,
  control: {
    target: {} as TargetState,
    current: {} as CurrentState
  }
} as unknown as Snapshot;
expectTypeOf(snapshot.runtime).toEqualTypeOf<RuntimeContext>();
expectTypeOf(snapshot.runtime.tokenBudgetUsed).toEqualTypeOf<number | undefined>();
expectTypeOf(snapshot.control.target).toEqualTypeOf<TargetState>();
expectTypeOf(snapshot.control.current).toEqualTypeOf<CurrentState>();

type Observer = ObserverHandler<TargetState, CurrentState>;
type Verifier = VerifierHandler<TargetState, CurrentState>;

const executionContext = {
  simulation: false,
  readOnly: true,
  k: 0,
  invokeTool: async () => undefined
} as unknown as RuntimeExecutionContext;

const observer = (async () => ({ goal: "noop" } as CurrentState)) as unknown as Observer;

const verifier = (async () => ({ status: "optimizing" as const })) as unknown as Verifier;

const tool = {
  execute: async () => undefined
} as unknown as ToolRegistration;

expectTypeOf(executionContext.invokeTool).toBeCallableWith("tool-ref", {
  dryRun: true
});
expectTypeOf(observer).returns.toMatchTypeOf<Promise<CurrentState> | CurrentState>();
expectTypeOf(verifier).returns.toMatchTypeOf<
  Promise<{ status?: RuntimeContext["status"] }> | { status?: RuntimeContext["status"] }
>();
expectTypeOf(tool.execute).toBeFunction();

// @ts-expect-error `goal` must remain a string across the public contract.
const invalidTarget: Snapshot["control"]["target"] = { goal: 123 };

compileControlSystem<TargetState, CurrentState>({
  schemas: {
    // @ts-expect-error `schemas.target` must match the declared `TTarget`.
    target: z.object({ goal: z.number() }),
    current: z.object({ goal: z.string() })
  },
  stopPolicy: {
    epsilon: 0.05,
    maxIterations: 3
  }
});

void invalidTarget;
