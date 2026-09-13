import { realpath } from "node:fs/promises";

import { loadAdapter, readRequirements, validatePreparation, validateProjection } from "./adapter.mjs";
import { BINDING_SCHEMA_VERSION, createBinding } from "./binding.mjs";
import { canonicalValue } from "./canonical-json.mjs";
import { readConfig, selectedAdapterName } from "./config.mjs";
import { fail } from "./errors.mjs";
import { canonicalWorkingDirectory } from "./paths.mjs";
import { resolveSession } from "./session.mjs";
import { claimBinding } from "./store.mjs";
import { createTarget } from "./target.mjs";

export async function markSession({ selection, description, provider, sessionId, adapterName, environment = process.env, workingDirectory = process.cwd(), now = () => new Date() }) {
  const session = resolveSession({ provider, sessionId, environment });
  const config = await readConfig({ environment });
  if (adapterName && adapterName !== selectedAdapterName(config)) fail("ADAPTER_MISMATCH", "The requested adapter is not configured.");
  const adapter = await loadAdapter(config);
  const workingReal = await realpath(workingDirectory).catch(() => null);
  const cwd = canonicalWorkingDirectory(workingReal);
  const normalizedSelection = canonicalValue(selection, { requireObject: true });
  const target = createTarget(normalizedSelection, await readRequirements(adapter));
  const { context } = adapter.prepareBinding === null
    ? { context: {} }
    : validatePreparation(await adapter.prepareBinding(Object.freeze({ target, workingDirectory: cwd })));
  const desired = createBinding({
    schemaVersion: BINDING_SCHEMA_VERSION,
    session,
    target,
    markedAt: now().toISOString(),
    workingDirectory: cwd,
    ...(description === undefined ? {} : { description }),
  });
  const claim = config.local.enabled
    ? await claimBinding(desired, { environment, directory: config.local.directory })
    : null;
  const binding = claim?.binding ?? desired;
  const projection = adapter.projectBinding === null
    ? null
    : validateProjection(await adapter.projectBinding(Object.freeze({ binding, context, ...(claim ? {} : { bindingPersisted: false }) })));
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
    ...(Object.hasOwn(binding, "description") ? { description: binding.description } : {}),
  });
}
