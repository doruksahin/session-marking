import { fail, plainObject } from "./errors.mjs";

const REQUIRED_FIELDS = ["project", "task"];
export const OPTIONAL_FIELDS = ["stageId"];
const SELECTION_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
const MAX_IDENTIFIER_LENGTH = 256;
const STAGE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export function describeSelection({ required = [], description = "" } = {}) {
  return {
    type: "object",
    required: [...REQUIRED_FIELDS, ...required],
    additionalProperties: false,
    ...(description ? { description } : {}),
    properties: {
      ...Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, {
        type: "string",
        minLength: 1,
        maxLength: MAX_IDENTIFIER_LENGTH,
        description: `Explicit ${field} identifier, without surrounding whitespace.`,
      }])),
      stageId: { type: "string", pattern: STAGE_PATTERN.source, description: "Stage identifier; a host may require it." },
    },
  };
}

export function createTarget(selection, { required = [] } = {}) {
  if (!plainObject(selection) || !Object.keys(selection).every((key) => SELECTION_FIELDS.includes(key))) {
    fail("SELECTION_INVALID", "Selection accepts project, task, and optional stageId.");
  }
  for (const field of REQUIRED_FIELDS) {
    const value = selection[field];
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) {
      fail("SELECTION_INVALID", `Selection ${field} must contain 1 to ${MAX_IDENTIFIER_LENGTH} characters without surrounding whitespace.`);
    }
  }
  if ((Object.hasOwn(selection, "stageId") || required.includes("stageId"))
    && (typeof selection.stageId !== "string" || !STAGE_PATTERN.test(selection.stageId))) {
    fail("SELECTION_INVALID", "Selection stageId must be a lowercase stage identifier of 1 to 64 characters.");
  }
  return Object.freeze({ kind: "session-marking/target-v1", project: selection.project, task: selection.task, ...(Object.hasOwn(selection, "stageId") ? { stageId: selection.stageId } : {}) });
}
