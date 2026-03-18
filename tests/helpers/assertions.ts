import type { ZodType } from "zod";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getShapeKeys(schema: ZodType<unknown>): string[] | null {
  const candidate = schema as ZodType<unknown> & {
    _def?: {
      shape?: Record<string, unknown> | (() => Record<string, unknown>);
    };
  };

  const rawShape = candidate._def?.shape;
  if (!rawShape) {
    return null;
  }

  const shape = typeof rawShape === "function" ? rawShape() : rawShape;
  return Object.keys(shape);
}

export function toBeSerializable(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (["string", "number", "boolean"].includes(typeof value)) {
    return true;
  }

  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return false;
  }

  if (typeof value !== "object") {
    return false;
  }

  if (value instanceof Date || value instanceof Map || value instanceof Set || value instanceof Promise) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.every((item) => toBeSerializable(item));
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return Object.values(value).every((item) => toBeSerializable(item));
}

export function assertStrictSchema<T>(schema: ZodType<T>, data: unknown): T {
  const parsed = schema.parse(data);
  const allowedKeys = getShapeKeys(schema);

  if (allowedKeys && isPlainObject(data) && isPlainObject(parsed)) {
    const leakedKeys = Object.keys(data).filter(
      (key) => !allowedKeys.includes(key) && key in parsed
    );

    if (leakedKeys.length > 0) {
      throw new Error(`Schema leaked unexpected keys: ${leakedKeys.join(", ")}`);
    }
  }

  return parsed;
}
