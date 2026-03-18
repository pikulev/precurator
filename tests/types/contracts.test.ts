import { expectTypeOf } from "expect-type";

import type { ControlState, RuntimeContext } from "../../src";
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

type Snapshot = ControlState<TargetState, CurrentState>;

declare const snapshot: Snapshot;
expectTypeOf(snapshot.runtime).toEqualTypeOf<RuntimeContext>();
expectTypeOf(snapshot.control.target).toEqualTypeOf<TargetState>();
expectTypeOf(snapshot.control.current).toEqualTypeOf<CurrentState>();

// @ts-expect-error `goal` must remain a string across the public contract.
const invalidTarget: Snapshot["control"]["target"] = { goal: 123 };

void invalidTarget;
