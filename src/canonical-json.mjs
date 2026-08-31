import { fail, plainObject } from "./errors.mjs";

const MAX_DEPTH = 16;
const MAX_BYTES = 16 * 1024;

function normalize(value, depth) {
  if (depth > MAX_DEPTH) fail("JSON_INVALID", "Structured data is nested too deeply.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => normalize(entry, depth + 1));
  if (!plainObject(value)) fail("JSON_INVALID", "Structured data contains an unsupported value.");
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!key || key.length > 128) fail("JSON_INVALID", "Structured data contains an invalid key.");
    result[key] = normalize(value[key], depth + 1);
  }
  return result;
}

export function canonicalValue(value, { requireObject = false } = {}) {
  const normalized = normalize(value, 0);
  if (requireObject && (!plainObject(normalized) || Object.keys(normalized).length === 0)) {
    fail("JSON_INVALID", "Structured data must be a non-empty object.");
  }
  if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_BYTES) {
    fail("JSON_INVALID", "Structured data is too large.");
  }
  return Object.freeze(normalized);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}
