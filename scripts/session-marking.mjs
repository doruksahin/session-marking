#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadAdapter, readRequirements } from "../src/adapter.mjs";
import { commandUsage, parseArguments, renderHelp } from "../src/cli.mjs";
import { configureAdapter, configureLocal, initializeConfig, readConfig, readStoredConfig, selectedAdapterName } from "../src/config.mjs";
import { SessionMarkError, fail } from "../src/errors.mjs";
import { markSession } from "../src/mark.mjs";
import { parseQuery, queryBindings } from "../src/query.mjs";
import { listBindings } from "../src/store.mjs";
import { describeSelection } from "../src/target.mjs";

function parseSelection(source) {
  let value;
  try { value = JSON.parse(source); } catch { fail("ARGUMENT_INVALID", "The target selection is invalid JSON."); }
  return value;
}

export async function runCli({ argv = process.argv.slice(2), environment = process.env, cwd = process.cwd() } = {}) {
  const { command, values, help } = parseArguments(argv);
  if (help) return renderHelp(command);
  if (command === "configure") {
    if (argv.length === 1) {
      const result = await initializeConfig({ environment });
      return Object.freeze({ ok: true, configPath: result.configPath, config: result.config });
    }
    if (values["--adapter"] === "local" && !values["--module"]) {
      const result = await configureLocal({ environment });
      return Object.freeze({ ok: true, adapter: "local", configPath: result.configPath });
    }
    if (!values["--adapter"] || !values["--module"]) fail("ARGUMENT_INVALID", commandUsage(command));
    const result = await configureAdapter({ name: values["--adapter"], modulePath: values["--module"], environment });
    return Object.freeze({ ok: true, adapter: result.config.host.name, module: result.config.host.module, configPath: result.configPath });
  }
  if (command === "describe") {
    const config = await readConfig({ environment });
    if (values["--adapter"] && values["--adapter"] !== selectedAdapterName(config)) fail("ADAPTER_MISMATCH", "The requested adapter is not configured.");
    const adapter = await loadAdapter(config);
    return Object.freeze({ ok: true, adapter: adapter.name, selection: describeSelection(await readRequirements(adapter)) });
  }
  if (command === "mark") {
    return markSession({ selection: parseSelection(values["--selection-json"]), description: values["--description"], provider: values["--provider"], sessionId: values["--session-id"], adapterName: values["--adapter"], environment, workingDirectory: cwd });
  }
  if (command === "list") {
    const query = parseQuery({ filters: values["--filter"], sort: values["--sort"], order: values["--order"] });
    const config = await readStoredConfig({ environment });
    const records = await listBindings({ environment, directory: config.local.directory });
    const sessions = queryBindings(records, query);
    return Object.freeze({ ok: true, sessions });
  }
}

export function runMain(options) {
  return runCli(options).then(
    (result) => process.stdout.write(`${typeof result === "string" ? result : JSON.stringify(result)}\n`),
    (error) => {
      const code = error instanceof SessionMarkError ? error.code : "SESSION_MARK_FAILED";
      const message = error instanceof SessionMarkError ? error.message : "The session could not be marked.";
      process.stderr.write(`${JSON.stringify({ ok: false, code, message })}\n`);
      process.exitCode = 1;
    },
  );
}

const invokedPath = process.argv[1] ? await realpath(path.resolve(process.argv[1])).catch(() => null) : null;
const modulePath = await realpath(fileURLToPath(import.meta.url)).catch(() => null);
if (invokedPath && invokedPath === modulePath) runMain();
