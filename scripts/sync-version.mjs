#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultPluginRoot = path.resolve(scriptRoot, "..");

function readJson(filePath) {
  let value;
  try { value = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { throw new Error(`Invalid JSON: ${filePath}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected a JSON object: ${filePath}`);
  return value;
}

function canonicalPackage(packageJson, packagePath) {
  if (typeof packageJson.name !== "string" || !packageJson.name) throw new Error(`Invalid package name: ${packagePath}`);
  if (!SEMVER_PATTERN.test(packageJson.version || "")) throw new Error(`Invalid session-marking version: ${packageJson.version || "missing"}`);
  return Object.freeze({ name: packageJson.name, version: packageJson.version });
}

function pluginManifest(filePath, packageName, version) {
  const manifest = readJson(filePath);
  if (manifest.name !== packageName || !SEMVER_PATTERN.test(manifest.version || "")) throw new Error(`Invalid plugin manifest: ${filePath}`);
  return { current: manifest.version, content: `${JSON.stringify({ ...manifest, version }, null, 2)}\n` };
}

function marketplaceManifest(filePath, packageName, version) {
  const marketplace = readJson(filePath);
  if (typeof marketplace.name !== "string" || !marketplace.name || !Array.isArray(marketplace.plugins)) throw new Error(`Invalid plugin marketplace: ${filePath}`);
  const matches = marketplace.plugins.filter((plugin) => plugin?.name === packageName);
  if (matches.length !== 1 || !SEMVER_PATTERN.test(matches[0].version || "")) throw new Error(`Invalid ${packageName} marketplace entry: ${filePath}`);
  const plugins = marketplace.plugins.map((plugin) => plugin?.name === packageName ? { ...plugin, version } : plugin);
  return { current: matches[0].version, content: `${JSON.stringify({ ...marketplace, plugins }, null, 2)}\n` };
}

export function versionPlan({ pluginRoot = defaultPluginRoot, marketplacePaths = [] } = {}) {
  const packagePath = path.join(pluginRoot, "package.json");
  const packageMetadata = canonicalPackage(readJson(packagePath), packagePath);
  const version = packageMetadata.version;
  const targets = [
    [path.join(pluginRoot, ".codex-plugin", "plugin.json"), pluginManifest],
    [path.join(pluginRoot, ".claude-plugin", "plugin.json"), pluginManifest],
    ...marketplacePaths.map((filePath) => [path.resolve(filePath), marketplaceManifest]),
  ].map(([filePath, planner]) => {
    const planned = planner(filePath, packageMetadata.name, version);
    return Object.freeze({ filePath, current: planned.current, content: planned.content });
  });
  if (new Set(targets.map((target) => target.filePath)).size !== targets.length) throw new Error("Version mirror paths must be unique");
  return Object.freeze({ version, targets: Object.freeze(targets) });
}

export function verifyVersionMirrors(options = {}) {
  const plan = versionPlan(options);
  const mismatches = plan.targets.filter((target) => target.current !== plan.version);
  if (mismatches.length > 0) throw new Error(`Session-marking version mismatch: ${mismatches.map((target) => path.basename(path.dirname(target.filePath)) + "/" + path.basename(target.filePath)).join(", ")}`);
  return Object.freeze({ version: plan.version, files: plan.targets.length });
}

export function syncVersionMirrors(options = {}) {
  const plan = versionPlan(options);
  const changed = plan.targets.filter((target) => fs.readFileSync(target.filePath, "utf8") !== target.content);
  for (const target of changed) fs.writeFileSync(target.filePath, target.content);
  verifyVersionMirrors(options);
  return Object.freeze({ version: plan.version, updated: Object.freeze(changed.map((target) => target.filePath)) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let check = false;
  const marketplacePaths = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--check" && !check) check = true;
    else if (args[index] === "--marketplace" && args[index + 1] && !args[index + 1].startsWith("--")) marketplacePaths.push(path.resolve(process.cwd(), args[++index]));
    else throw new Error("Usage: sync-version.mjs [--check] [--marketplace <path>]...");
  }
  if (check) {
    const result = verifyVersionMirrors({ marketplacePaths });
    console.log(`Session-marking versions verified: ${result.version} (${result.files} mirrors)`);
  } else {
    const result = syncVersionMirrors({ marketplacePaths });
    console.log(`Session-marking versions ${result.updated.length > 0 ? "synchronized" : "already current"}: ${result.version}`);
  }
}
