import { expectTypeOf } from "expect-type";

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

declare const snapshot: Snapshot;
expectTypeOf(snapshot.runtime).toEqualTypeOf<RuntimeContext>();
expectTypeOf(snapshot.runtime.tokenBudgetUsed).toEqualTypeOf<number | undefined>();
expectTypeOf(snapshot.control.target).toEqualTypeOf<TargetState>();
expectTypeOf(snapshot.control.current).toEqualTypeOf<CurrentState>();

type Observer = ObserverHandler<TargetState, CurrentState>;
type Verifier = VerifierHandler<TargetState, CurrentState>;

declare const executionContext: RuntimeExecutionContext;
declare const observer: Observer;
declare const verifier: Verifier;
declare const tool: ToolRegistration;

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

void invalidTarget;
