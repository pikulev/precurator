import { NonSerializableDataError } from "./errors";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Returns true iff `value` is JSON-ready "POJO-like" data:
 * - primitives/null
 * - arrays of JSON-ready values
 * - plain objects with JSON-ready values
 *
 * Intentionally rejects Date/Map/Set/Promise/classes/etc. to keep LangGraph
 * state/checkpoint compatible.
 */
export function isJsonReadySerializable(value: unknown): boolean {
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
    return value.every((item) => isJsonReadySerializable(item));
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return Object.values(value).every((item) => isJsonReadySerializable(item));
}

export function assertJsonReadySerializable(
  value: unknown,
  label: string
): void {
  if (!isJsonReadySerializable(value)) {
    const valueType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    throw new NonSerializableDataError(
      `Non-serializable data detected for "${label}".`,
      { label, valueType }
    );
  }
}

