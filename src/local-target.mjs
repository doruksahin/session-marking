import { exactKeys, fail } from "./errors.mjs";

const SELECTION_FIELDS = ["project", "task"];
const MAX_IDENTIFIER_LENGTH = 256;

export function describeSelection() {
  return {
    type: "object",
    required: [...SELECTION_FIELDS],
    additionalProperties: false,
    properties: Object.fromEntries(SELECTION_FIELDS.map((field) => [field, {
      type: "string",
      minLength: 1,
      maxLength: MAX_IDENTIFIER_LENGTH,
      description: `Explicit ${field} identifier, without surrounding whitespace.`,
    }])),
  };
}

export function resolveTarget({ selection }) {
  if (!exactKeys(selection, SELECTION_FIELDS)) {
    fail("SELECTION_INVALID", "Local selection requires exactly project and task.");
  }
  for (const field of SELECTION_FIELDS) {
    const value = selection[field];
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) {
      fail("SELECTION_INVALID", `Local selection ${field} must contain 1 to ${MAX_IDENTIFIER_LENGTH} characters without surrounding whitespace.`);
    }
  }
  return {
    target: { kind: "local/project-task-v1", project: selection.project, task: selection.task },
    context: {},
  };
}
