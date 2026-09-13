import { fail } from "./errors.mjs";

const ROOTS = ["schemaVersion", "session", "target", "markedAt", "workingDirectory"];

function fieldPath(value) {
  const parts = value.split(".");
  if (!ROOTS.includes(parts[0]) || !parts.every((part) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(part))) {
    fail("ARGUMENT_INVALID", "Use a dot-separated binding field path, such as target.project or session.provider.");
  }
  return parts;
}

function scalarText(record, parts) {
  let value = record;
  for (const part of parts) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value === null || ["string", "number", "boolean"].includes(typeof value) ? String(value) : undefined;
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function parseQuery({ filters = [], sort, order } = {}) {
  const direction = order ?? (sort === undefined ? "desc" : "asc");
  if (!["asc", "desc"].includes(direction)) fail("ARGUMENT_INVALID", "The list order must be asc or desc.");
  const sortPath = fieldPath(sort ?? "markedAt");
  const conditions = filters.map((filter) => {
    const separator = filter.indexOf("=");
    if (separator < 1) fail("ARGUMENT_INVALID", "Use --filter field.path=value.");
    return { path: fieldPath(filter.slice(0, separator)), value: filter.slice(separator + 1) };
  });
  return { direction, sortPath, conditions };
}

export function queryBindings(records, { direction, sortPath, conditions }) {
  return records.filter((record) => conditions.every((condition) => scalarText(record, condition.path) === condition.value))
    .sort((left, right) => {
      const leftValue = scalarText(left, sortPath);
      const rightValue = scalarText(right, sortPath);
      if (leftValue === undefined && rightValue !== undefined) return 1;
      if (rightValue === undefined && leftValue !== undefined) return -1;
      const result = compare(leftValue, rightValue) * (direction === "asc" ? 1 : -1);
      return result || compare(left.session.provider, right.session.provider) || compare(left.session.id, right.session.id);
    });
}
