import { canonicalJson, canonicalValue } from "./canonical-json.mjs";
import { exactKeys, fail } from "./errors.mjs";
import { canonicalWorkingDirectory } from "./paths.mjs";
import { SESSION_ID_PATTERN, sessionUrl, validateProvider } from "./session.mjs";

export const BINDING_SCHEMA_VERSION = 2;

function canonicalTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    fail("BINDING_INVALID", "The binding timestamp is invalid.");
  }
  return value;
}

export function createBinding(input) {
  if (!exactKeys(input, ["markedAt", "schemaVersion", "session", "target", "workingDirectory"]) || input.schemaVersion !== BINDING_SCHEMA_VERSION) {
    fail("BINDING_INVALID", "The session binding schema is invalid.");
  }
  if (!exactKeys(input.session, ["id", "provider", "url"])) fail("BINDING_INVALID", "The binding session schema is invalid.");
  const provider = validateProvider(input.session.provider, "BINDING_INVALID");
  if (!SESSION_ID_PATTERN.test(input.session.id || "") || input.session.url !== sessionUrl(provider, input.session.id)) {
    fail("BINDING_INVALID", "The binding session identity is invalid.");
  }
  return Object.freeze({
    schemaVersion: BINDING_SCHEMA_VERSION,
    session: Object.freeze({ provider, id: input.session.id, url: input.session.url }),
    target: canonicalValue(input.target, { requireObject: true }),
    markedAt: canonicalTimestamp(input.markedAt),
    workingDirectory: canonicalWorkingDirectory(input.workingDirectory),
  });
}

export function parseBinding(source) {
  let value;
  try { value = JSON.parse(source); } catch { fail("BINDING_INVALID", "The existing session binding is invalid JSON."); }
  const binding = createBinding(value);
  if (renderBinding(binding) !== `${source.trimEnd()}\n`) fail("BINDING_INVALID", "The existing session binding is not canonical.");
  return binding;
}

export function renderBinding(binding) {
  return `${JSON.stringify(binding, null, 2)}\n`;
}

export function bindingMatches(left, right) {
  return left.schemaVersion === right.schemaVersion
    && left.session.provider === right.session.provider
    && left.session.id === right.session.id
    && canonicalJson(left.target) === canonicalJson(right.target);
}
