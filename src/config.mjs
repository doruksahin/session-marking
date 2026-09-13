import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { exactKeys, fail } from "./errors.mjs";
import { configDirectory } from "./paths.mjs";
import { readOptionalFile, replacePrivateFile } from "./safe-files.mjs";

const CONFIG_VERSION = 1;
const LOCAL_CONFIG = Object.freeze({ schemaVersion: 2, mode: "local" });
const ADAPTER_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export function selectedAdapterName(config) {
  return config.mode === "local" ? "local" : config.adapter.name;
}

function parseConfig(source) {
  let value;
  try { value = JSON.parse(source); } catch { fail("CONFIG_INVALID", "Session-marking configuration is invalid JSON."); }
  if (exactKeys(value, ["mode", "schemaVersion"]) && value.schemaVersion === LOCAL_CONFIG.schemaVersion && value.mode === LOCAL_CONFIG.mode) return LOCAL_CONFIG;
  if (!exactKeys(value, ["adapter", "schemaVersion"]) || value.schemaVersion !== CONFIG_VERSION) fail("CONFIG_INVALID", "Session-marking configuration has an unsupported schema.");
  if (!exactKeys(value.adapter, ["module", "name"]) || !ADAPTER_NAME_PATTERN.test(value.adapter.name || "") || typeof value.adapter.module !== "string" || !path.isAbsolute(value.adapter.module)) {
    fail("CONFIG_INVALID", "The configured adapter is invalid.");
  }
  return Object.freeze({ schemaVersion: CONFIG_VERSION, adapter: Object.freeze({ name: value.adapter.name, module: path.normalize(value.adapter.module) }) });
}

async function canonicalModule(modulePath) {
  if (typeof modulePath !== "string" || !path.isAbsolute(modulePath)) fail("ADAPTER_INVALID", "The adapter module path must be absolute.");
  const canonical = await realpath(modulePath).catch(() => null);
  const stat = canonical ? await lstat(canonical).catch(() => null) : null;
  if (!canonical || !stat?.isFile() || stat.isSymbolicLink()) fail("ADAPTER_INVALID", "The adapter module is not a canonical regular file.");
  return canonical;
}

export async function configureAdapter({ name, modulePath, environment = process.env }) {
  if (!ADAPTER_NAME_PATTERN.test(name || "")) fail("ADAPTER_INVALID", "The adapter name is invalid.");
  const module = await canonicalModule(modulePath);
  const config = Object.freeze({ schemaVersion: CONFIG_VERSION, adapter: Object.freeze({ name, module }) });
  const directory = configDirectory(environment);
  const configPath = await replacePrivateFile(directory, "config.json", `${JSON.stringify(config, null, 2)}\n`);
  return Object.freeze({ config, configPath });
}

export async function configureLocal({ environment = process.env } = {}) {
  const directory = configDirectory(environment);
  const configPath = await replacePrivateFile(directory, "config.json", `${JSON.stringify(LOCAL_CONFIG, null, 2)}\n`);
  return Object.freeze({ config: LOCAL_CONFIG, configPath });
}

export async function readConfig({ environment = process.env } = {}) {
  const directory = configDirectory(environment);
  const source = await readOptionalFile(path.join(directory, "config.json"), 64 * 1024);
  if (source === null) return LOCAL_CONFIG;
  const config = parseConfig(source);
  if (config.mode === "local") return config;
  const module = await canonicalModule(config.adapter.module);
  if (module !== config.adapter.module) fail("CONFIG_INVALID", "The configured adapter path is not canonical.");
  return config;
}
