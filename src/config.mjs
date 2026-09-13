import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { exactKeys, fail, plainObject } from "./errors.mjs";
import { configDirectory, configuredLocalDirectory } from "./paths.mjs";
import { publishExclusive, readOptionalFile, replacePrivateFile, secureDirectory } from "./safe-files.mjs";

const ADAPTER_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function knownKeys(value, allowed) {
  return plainObject(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function configValue(value, defaults) {
  if (!knownKeys(value, ["schemaVersion", "local", "host"]) || value.schemaVersion !== 3
    || (Object.hasOwn(value, "local") && !knownKeys(value.local, ["enabled", "directory"]))
    || (Object.hasOwn(value, "host") && !knownKeys(value.host, ["enabled", "name", "module"]))) {
    fail("CONFIG_INVALID", "Session-marking configuration has an unsupported schema.");
  }
  const local = { ...defaults?.local, ...value.local };
  local.directory = configuredLocalDirectory(local.directory);
  const host = { ...defaults?.host, ...value.host };
  if (typeof local.enabled !== "boolean" || typeof host.enabled !== "boolean"
    || !(host.name === null || (typeof host.name === "string" && ADAPTER_NAME_PATTERN.test(host.name)))
    || !(host.module === null || (typeof host.module === "string" && path.isAbsolute(host.module)))
    || (host.enabled && (host.name === null || host.module === null))) {
    fail("CONFIG_INVALID", "The configured outputs are invalid.");
  }
  return Object.freeze({ schemaVersion: 3, local: Object.freeze(local), host: Object.freeze(host) });
}

function parseJson(source) {
  try { return JSON.parse(source); } catch { fail("CONFIG_INVALID", "Session-marking configuration is invalid JSON."); }
}

const DEFAULT_CONFIG = configValue(parseJson(await readFile(new URL("../config.defaults.json", import.meta.url), "utf8")));

export function selectedAdapterName(config) {
  return config.host.enabled ? config.host.name : "local";
}

function parseConfig(source) {
  const value = parseJson(source);
  if (exactKeys(value, ["mode", "schemaVersion"]) && value.schemaVersion === 2 && value.mode === "local") {
    return configValue({ schemaVersion: 3, local: { enabled: true }, host: { enabled: false } }, DEFAULT_CONFIG);
  }
  if (exactKeys(value, ["adapter", "schemaVersion"]) && value.schemaVersion === 1) {
    if (!exactKeys(value.adapter, ["module", "name"]) || typeof value.adapter.name !== "string"
      || !ADAPTER_NAME_PATTERN.test(value.adapter.name) || typeof value.adapter.module !== "string" || !path.isAbsolute(value.adapter.module)) {
      fail("CONFIG_INVALID", "The configured adapter is invalid.");
    }
    return configValue({ schemaVersion: 3, local: { enabled: true }, host: { enabled: true, name: value.adapter.name, module: path.normalize(value.adapter.module) } }, DEFAULT_CONFIG);
  }
  return configValue(value, DEFAULT_CONFIG);
}

async function canonicalModule(modulePath) {
  if (typeof modulePath !== "string" || !path.isAbsolute(modulePath)) fail("ADAPTER_INVALID", "The adapter module path must be absolute.");
  const canonical = await realpath(modulePath).catch(() => null);
  const stat = canonical ? await lstat(canonical).catch(() => null) : null;
  if (!canonical || !stat?.isFile() || stat.isSymbolicLink()) fail("ADAPTER_INVALID", "The adapter module is not a canonical regular file.");
  return canonical;
}

async function storedConfig(environment) {
  const source = await readOptionalFile(path.join(configDirectory(environment), "config.json"), 64 * 1024);
  return source === null ? DEFAULT_CONFIG : parseConfig(source);
}

async function writeConfig(config, environment) {
  const configPath = await replacePrivateFile(configDirectory(environment), "config.json", `${JSON.stringify(config, null, 2)}\n`);
  return Object.freeze({ config, configPath });
}

export async function configureAdapter({ name, modulePath, environment = process.env }) {
  if (typeof name !== "string" || !ADAPTER_NAME_PATTERN.test(name)) fail("ADAPTER_INVALID", "The adapter name is invalid.");
  const module = await canonicalModule(modulePath);
  const previous = await storedConfig(environment);
  return writeConfig(configValue({ ...previous, host: { enabled: true, name, module } }), environment);
}

export async function configureLocal({ environment = process.env } = {}) {
  const previous = await storedConfig(environment);
  return writeConfig(configValue({ ...previous, local: { ...previous.local, enabled: true }, host: { ...previous.host, enabled: false } }), environment);
}

export async function readConfig({ environment = process.env } = {}) {
  const config = await storedConfig(environment);
  if (!config.local.enabled && !config.host.enabled) fail("CONFIG_INVALID", "Enable at least one session-marking output.");
  if (config.host.enabled) {
    const module = await canonicalModule(config.host.module);
    if (module !== config.host.module) fail("CONFIG_INVALID", "The configured adapter path is not canonical.");
  }
  return config;
}

export async function initializeConfig({ environment = process.env } = {}) {
  const directory = configDirectory(environment);
  const configPath = path.join(directory, "config.json");
  if (await readOptionalFile(configPath, 64 * 1024) === null) {
    await secureDirectory(directory);
    // Publish only if still missing: a concurrent setup or user edit wins unchanged.
    await publishExclusive(directory, "config.json", `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 0o600);
  }
  return Object.freeze({ config: await readConfig({ environment }), configPath });
}
