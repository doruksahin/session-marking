import path from "node:path";
import { lstat, readdir, realpath } from "node:fs/promises";

import { bindingMatches, parseBinding, renderBinding } from "./binding.mjs";
import { fail } from "./errors.mjs";
import { stateDirectory } from "./paths.mjs";
import { publishExclusive, readOptionalFile, secureChildDirectory } from "./safe-files.mjs";
import { PROVIDERS, SESSION_ID_PATTERN } from "./session.mjs";

async function existingDirectory(directory) {
  const stat = await lstat(directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    fail("PATH_UNSAFE", "The local binding directory could not be inspected.");
  });
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory).catch(() => null) !== directory) {
    fail("PATH_UNSAFE", "The local binding directory is not canonical.");
  }
  return true;
}

export async function listBindings({ environment = process.env, directory = null } = {}) {
  const root = stateDirectory(environment, process.platform, directory);
  const bindings = path.join(root, "bindings");
  if (!await existingDirectory(root) || !await existingDirectory(bindings)) return [];
  const records = [];
  for (const provider of PROVIDERS) {
    const providerDirectory = path.join(bindings, provider);
    if (!await existingDirectory(providerDirectory)) continue;
    const names = await readdir(providerDirectory).catch(() => fail("FILE_INVALID", "The local binding directory could not be read."));
    for (const name of names.sort()) {
      if (name.startsWith(".") || !name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!SESSION_ID_PATTERN.test(id)) fail("BINDING_INVALID", "A local binding filename is invalid.");
      const source = await readOptionalFile(path.join(providerDirectory, name), 64 * 1024);
      if (source === null) fail("FILE_INVALID", "A listed session binding could not be read.");
      const binding = parseBinding(source);
      if (binding.session.provider !== provider || binding.session.id !== id) {
        fail("BINDING_INVALID", "A local binding does not match its file identity.");
      }
      records.push(binding);
    }
  }
  return records;
}

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
