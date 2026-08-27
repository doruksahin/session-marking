export class SessionMarkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SessionMarkError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new SessionMarkError(code, message);
}

export function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
