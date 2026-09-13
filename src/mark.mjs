import { realpath } from "node:fs/promises";

import { loadAdapter, validateProjection, validateResolution } from "./adapter.mjs";
import { BINDING_SCHEMA_VERSION, createBinding } from "./binding.mjs";
import { canonicalValue } from "./canonical-json.mjs";
import { readConfig, selectedAdapterName } from "./config.mjs";
import { fail } from "./errors.mjs";
import { canonicalWorkingDirectory } from "./paths.mjs";
import { currentSession } from "./session.mjs";
import { claimBinding } from "./store.mjs";

export async function markCurrentSession({ selection, adapterName, environment = process.env, workingDirectory = process.cwd(), now = () => new Date() }) {
  const config = await readConfig({ environment });
  if (adapterName && adapterName !== selectedAdapterName(config)) fail("ADAPTER_MISMATCH", "The requested adapter is not configured.");
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
  const claim = config.local.enabled
    ? await claimBinding(desired, { environment, directory: config.local.directory })
    : null;
  const binding = claim?.binding ?? desired;
  const projection = adapter.projectBinding === null
    ? null
    : validateProjection(await adapter.projectBinding(Object.freeze({ binding, context: resolution.context, ...(claim ? {} : { bindingPersisted: false }) })));
  return Object.freeze({
    ok: true,
    adapter: adapter.name,
    provider: binding.session.provider,
    sessionId: binding.session.id,
    sessionUrl: binding.session.url,
    binding: claim?.status ?? null,
    bindingPath: claim?.targetPath ?? null,
    local: claim ? Object.freeze({ bindingPath: claim.targetPath }) : null,
    target: binding.target,
    projection,
  });
}
