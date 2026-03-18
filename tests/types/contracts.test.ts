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

type Snapshot = ControlState<TargetState, CurrentState>;

declare const snapshot: Snapshot;
expectTypeOf(snapshot.runtime).toEqualTypeOf<RuntimeContext>();
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
