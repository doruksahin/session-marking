import { realpath } from "node:fs/promises";

import { loadAdapter, validateProjection, validateResolution } from "./adapter.mjs";
import { BINDING_SCHEMA_VERSION, createBinding } from "./binding.mjs";
import { canonicalValue } from "./canonical-json.mjs";
import { readConfig } from "./config.mjs";
import { fail } from "./errors.mjs";
import { canonicalWorkingDirectory } from "./paths.mjs";
import { currentSession } from "./session.mjs";
import { claimBinding } from "./store.mjs";

export async function markCurrentSession({ selection, adapterName, environment = process.env, workingDirectory = process.cwd(), now = () => new Date() }) {
  const config = await readConfig({ environment });
  if (adapterName && adapterName !== config.adapter.name) fail("ADAPTER_MISMATCH", "The requested adapter is not configured.");
  const adapter = await loadAdapter(config);
  const session = currentSession(environment);
  const workingReal = await realpath(workingDirectory).catch(() => null);
  const cwd = canonicalWorkingDirectory(workingReal);
  const normalizedSelection = canonicalValue(selection, { requireObject: true });
  const resolution = validateResolution(await adapter.resolveTarget(Object.freeze({ selection: normalizedSelection, workingDirectory: cwd })));
  const desired = createBinding({
    schemaVersion: BINDING_SCHEMA_VERSION,
    session,
    target: resolution.target,
    markedAt: now().toISOString(),
    workingDirectory: cwd,
  });
  const claim = await claimBinding(desired, { environment });
  const projection = validateProjection(await adapter.projectBinding(Object.freeze({ binding: claim.binding, context: resolution.context })));
  return Object.freeze({
    ok: true,
    adapter: adapter.name,
    provider: claim.binding.session.provider,
    sessionId: claim.binding.session.id,
    sessionUrl: claim.binding.session.url,
    binding: claim.status,
    target: claim.binding.target,
    projection,
  });
}
