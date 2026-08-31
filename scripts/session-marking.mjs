#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadAdapter, validateDescription } from "../src/adapter.mjs";
import { configureAdapter, readConfig } from "../src/config.mjs";
import { SessionMarkError, fail } from "../src/errors.mjs";
import { markCurrentSession } from "../src/mark.mjs";

function argumentMap(argv, allowed) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.includes(key) || !value || value.startsWith("--") || Object.hasOwn(values, key)) fail("ARGUMENT_INVALID", "The session-marking arguments are invalid.");
    values[key] = value;
  }
  return values;
}

function parseSelection(source) {
  let value;
  try { value = JSON.parse(source); } catch { fail("ARGUMENT_INVALID", "The target selection is invalid JSON."); }
  return value;
}

export async function runCli({ argv = process.argv.slice(2), environment = process.env, cwd = process.cwd() } = {}) {
  const command = argv[0];
  if (command === "configure") {
    const values = argumentMap(argv.slice(1), ["--adapter", "--module"]);
    if (!values["--adapter"] || !values["--module"]) fail("ARGUMENT_INVALID", "Usage: session-marking configure --adapter <name> --module <absolute-path>");
    const result = await configureAdapter({ name: values["--adapter"], modulePath: values["--module"], environment });
    return Object.freeze({ ok: true, adapter: result.config.adapter.name, module: result.config.adapter.module, configPath: result.configPath });
  }
  if (command === "describe") {
    const values = argumentMap(argv.slice(1), ["--adapter"]);
    const config = await readConfig({ environment });
    if (values["--adapter"] && values["--adapter"] !== config.adapter.name) fail("ADAPTER_MISMATCH", "The requested adapter is not configured.");
    const adapter = await loadAdapter(config);
    return Object.freeze({ ok: true, adapter: adapter.name, selection: validateDescription(await adapter.describeSelection()) });
  }
  if (command === "mark") {
    const values = argumentMap(argv.slice(1), ["--adapter", "--selection-json"]);
    if (!values["--selection-json"]) fail("ARGUMENT_INVALID", "Usage: session-marking mark [--adapter <name>] --selection-json <json-object>");
    return markCurrentSession({ selection: parseSelection(values["--selection-json"]), adapterName: values["--adapter"], environment, workingDirectory: cwd });
  }
  fail("ARGUMENT_INVALID", "Usage: session-marking <configure|describe|mark> ...");
}

export function runMain(options) {
  return runCli(options).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      const code = error instanceof SessionMarkError ? error.code : "SESSION_MARK_FAILED";
      const message = error instanceof SessionMarkError ? error.message : "The current session could not be marked.";
      process.stderr.write(`${JSON.stringify({ ok: false, code, message })}\n`);
      process.exitCode = 1;
    },
  );
}

const invokedPath = process.argv[1] ? await realpath(path.resolve(process.argv[1])).catch(() => null) : null;
const modulePath = await realpath(fileURLToPath(import.meta.url)).catch(() => null);
if (invokedPath && invokedPath === modulePath) runMain();
