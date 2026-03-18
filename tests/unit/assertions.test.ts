import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assertStrictSchema, toBeSerializable } from "../helpers/assertions";

describe("test helpers", () => {
  it("accepts plain JSON-safe objects", () => {
    expect(
      toBeSerializable({
        nested: {
          ok: true
        },
        values: [1, "two", null]
      })
    ).toBe(true);
  });

  it("rejects class instances and promises", () => {
    class HiddenState {
      constructor(readonly value: number) {}
    }

    expect(toBeSerializable(new HiddenState(1))).toBe(false);
    expect(toBeSerializable(Promise.resolve("nope"))).toBe(false);
  });

  it("accepts strip schemas that remove unknown keys", () => {
    const schema = z.object({
      goal: z.string()
    });

    expect(
      assertStrictSchema(schema, {
        goal: "ship",
        leaked: true
      })
    ).toEqual({ goal: "ship" });
  });

  it("fails when strict schemas receive unknown keys", () => {
    const schema = z
      .object({
        goal: z.string()
      })
      .strict();

    expect(() =>
      assertStrictSchema(schema, {
        goal: "ship",
        leaked: true
      })
    ).toThrow();
  });
});
