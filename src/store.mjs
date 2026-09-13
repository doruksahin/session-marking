import path from "node:path";

import { bindingMatches, parseBinding, renderBinding } from "./binding.mjs";
import { fail } from "./errors.mjs";
import { stateDirectory } from "./paths.mjs";
import { publishExclusive, readOptionalFile, secureChildDirectory } from "./safe-files.mjs";

export async function claimBinding(binding, { environment = process.env, directory: configuredDirectory = null } = {}) {
  const root = stateDirectory(environment, process.platform, configuredDirectory);
  const directory = await secureChildDirectory(root, "bindings", binding.session.provider);
  const filename = `${binding.session.id}.json`;
  const targetPath = path.join(directory, filename);
  const existing = await readOptionalFile(targetPath, 64 * 1024);
  if (existing) {
    const winner = parseBinding(existing);
    if (!bindingMatches(winner, binding)) fail("BINDING_CONFLICT", "This session is already marked for another target.");
    return Object.freeze({ binding: winner, status: "existing", targetPath });
  }
  if (await publishExclusive(directory, filename, renderBinding(binding), 0o600)) {
    return Object.freeze({ binding, status: "created", targetPath });
  }
  const winnerSource = await readOptionalFile(targetPath, 64 * 1024);
  if (!winnerSource) fail("WRITE_FAILED", "The winning session binding could not be read.");
  const winner = parseBinding(winnerSource);
  if (!bindingMatches(winner, binding)) fail("BINDING_CONFLICT", "This session is already marked for another target.");
  return Object.freeze({ binding: winner, status: "existing", targetPath });
}
