import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configureLocal, readConfig } from "../src/config.mjs";
import { runCli } from "../scripts/session-marking.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "session-marking-local-config-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environment = {
    HOME: root,
    SESSION_MARKING_CONFIG_DIR: path.join(root, "config"),
    SESSION_MARKING_STATE_DIR: path.join(root, "state"),
  };
  const configPath = path.join(environment.SESSION_MARKING_CONFIG_DIR, "config.json");
  const cli = (argv, sessionId) => runCli({ argv, cwd: root, environment: sessionId ? { ...environment, CODEX_THREAD_ID: sessionId, CODEX_SESSION_ID: sessionId } : environment });
  return { root, environment, configPath, cli };
}

async function externalModule(root) {
  const modulePath = path.join(root, "adapter.mjs");
  await writeFile(modulePath, [
    "export const adapterApiVersion = 1;",
    "export function describeSelection() { return { external: true }; }",
    "export function resolveTarget({ selection }) { return { target: { external: selection.work }, context: {} }; }",
    "export function projectBinding() { return { status: 'external' }; }",
  ].join("\n"));
  return modulePath;
}

test("a fresh installation describes local selection without creating config or state", async (t) => {
  const item = await fixture(t);
  assert.deepEqual(await readConfig({ environment: item.environment }), { schemaVersion: 2, mode: "local" });
  assert.equal((await item.cli(["describe"])).adapter, "local");
  assert.equal((await item.cli(["describe", "--adapter", "local"])).adapter, "local");
  await assert.rejects(item.cli(["describe", "--adapter", "other"]), { code: "ADAPTER_MISMATCH" });
  assert.deepEqual(await readdir(item.root), []);
});

test("explicit local configuration is minimal, private, and reloadable", async (t) => {
  const item = await fixture(t);
  const result = await item.cli(["configure", "--adapter", "local"]);
  assert.deepEqual(result, { ok: true, adapter: "local", configPath: item.configPath });
  assert.deepEqual(JSON.parse(await readFile(item.configPath, "utf8")), { schemaVersion: 2, mode: "local" });
  assert.equal((await stat(item.configPath)).mode & 0o777, 0o600);
  assert.deepEqual(await readConfig({ environment: item.environment }), { schemaVersion: 2, mode: "local" });
  assert.deepEqual((await configureLocal({ environment: item.environment })).config, { schemaVersion: 2, mode: "local" });
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("invalid existing configuration never falls back to local mode", async (t) => {
  const item = await fixture(t);
  await mkdir(item.environment.SESSION_MARKING_CONFIG_DIR);
  const invalidSources = [
    "", "{", "null", "[]", "{}",
    JSON.stringify({ schemaVersion: 2, mode: "other" }),
    JSON.stringify({ schemaVersion: 3, mode: "local" }),
    JSON.stringify({ schemaVersion: 1, mode: "local" }),
    JSON.stringify({ schemaVersion: 2, mode: "local", directory: item.root }),
    JSON.stringify({ schemaVersion: 2, mode: "local", adapter: { name: "other", module: "/adapter.mjs" } }),
    JSON.stringify({ schemaVersion: 1, adapter: { name: "other", module: "relative.mjs" } }),
  ];
  for (const source of invalidSources) {
    await writeFile(item.configPath, source);
    await assert.rejects(item.cli(["describe"]), { code: "CONFIG_INVALID" }, source);
    assert.equal(await readFile(item.configPath, "utf8"), source);
  }
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("unsafe config files and unavailable external modules fail without selecting local", async (t) => {
  const item = await fixture(t);
  await mkdir(item.environment.SESSION_MARKING_CONFIG_DIR);
  await mkdir(item.configPath);
  await assert.rejects(item.cli(["describe"]), { code: "FILE_INVALID" });
  await rm(item.configPath, { recursive: true });
  const outside = path.join(item.root, "other-config.json");
  await writeFile(outside, JSON.stringify({ schemaVersion: 2, mode: "local" }));
  await symlink(outside, item.configPath);
  await assert.rejects(item.cli(["describe"]), { code: "FILE_INVALID" });
  await rm(item.configPath);
  await writeFile(item.configPath, JSON.stringify({ schemaVersion: 1, adapter: { name: "fixture", module: path.join(item.root, "missing.mjs") } }));
  await assert.rejects(item.cli(["describe"]), { code: "ADAPTER_INVALID" });
});

test("configure rejects incomplete, duplicate, and unsupported flags without writing configuration", async (t) => {
  const item = await fixture(t);
  for (const argv of [
    ["configure"],
    ["configure", "--adapter", "fixture"],
    ["configure", "--module", "/adapter.mjs"],
    ["configure", "--adapter", "local", "--module"],
    ["configure", "--adapter", "local", "--directory", item.root],
    ["configure", "--adapter", "local", "--adapter", "fixture"],
  ]) await assert.rejects(item.cli(argv), { code: "ARGUMENT_INVALID" });
  assert.deepEqual(await readdir(item.root), []);
});

test("an external adapter named local remains an external schema-one integration", async (t) => {
  const item = await fixture(t);
  const modulePath = await externalModule(item.root);
  assert.deepEqual(await item.cli(["configure", "--adapter", "local", "--module", modulePath]), {
    ok: true, adapter: "local", module: modulePath, configPath: item.configPath,
  });
  assert.deepEqual(await readConfig({ environment: item.environment }), {
    schemaVersion: 1, adapter: { name: "local", module: modulePath },
  });
  assert.deepEqual(await item.cli(["describe", "--adapter", "local"]), {
    ok: true, adapter: "local", selection: { external: true },
  });
  const marked = await item.cli(["mark", "--adapter", "local", "--selection-json", '{"work":"external-task"}'], "external-local");
  assert.deepEqual(marked.target, { external: "external-task" });
  assert.deepEqual(marked.projection, { status: "external" });
});

test("an adapter mismatch fails before executing the configured external module", async (t) => {
  const item = await fixture(t);
  const modulePath = path.join(item.root, "side-effect-adapter.mjs");
  const sentinelPath = path.join(item.root, "imported.txt");
  await writeFile(modulePath, [
    "import { writeFile } from 'node:fs/promises';",
    `await writeFile(${JSON.stringify(sentinelPath)}, 'imported');`,
    "throw new Error('must not import');",
  ].join("\n"));
  await item.cli(["configure", "--adapter", "fixture", "--module", modulePath]);
  await assert.rejects(item.cli(["describe", "--adapter", "local"]), { code: "ADAPTER_MISMATCH" });
  await assert.rejects(item.cli(["mark", "--adapter", "local", "--selection-json", '{"project":"website","task":"fix-login"}'], "mismatch"), { code: "ADAPTER_MISMATCH" });
  await assert.rejects(stat(sentinelPath), { code: "ENOENT" });
});

test("switching between local and external configuration preserves immutable session records", async (t) => {
  const item = await fixture(t);
  const localArgs = ["mark", "--selection-json", '{"project":"website","task":"fix-login"}'];
  assert.equal((await item.cli(localArgs, "local-session")).binding, "created");
  const localPath = path.join(item.environment.SESSION_MARKING_STATE_DIR, "bindings", "codex", "local-session.json");
  const localRecord = await readFile(localPath, "utf8");
  const modulePath = await externalModule(item.root);
  await item.cli(["configure", "--adapter", "fixture", "--module", modulePath]);
  const externalArgs = ["mark", "--selection-json", '{"work":"external-task"}'];
  assert.equal((await item.cli(externalArgs, "external-session")).binding, "created");
  const externalPath = path.join(item.environment.SESSION_MARKING_STATE_DIR, "bindings", "codex", "external-session.json");
  const externalRecord = await readFile(externalPath, "utf8");
  await item.cli(["configure", "--adapter", "local"]);
  assert.equal((await item.cli(localArgs, "local-session")).binding, "existing");
  await assert.rejects(item.cli(localArgs, "external-session"), { code: "BINDING_CONFLICT" });
  assert.equal(await readFile(localPath, "utf8"), localRecord);
  assert.equal(await readFile(externalPath, "utf8"), externalRecord);
  await item.cli(["configure", "--adapter", "fixture", "--module", modulePath]);
  assert.equal((await item.cli(externalArgs, "external-session")).binding, "existing");
  assert.equal(await readFile(externalPath, "utf8"), externalRecord);
});
