import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configureLocal, readConfig } from "../src/config.mjs";
import { stateDirectory } from "../src/paths.mjs";
import { runCli } from "../scripts/session-marking.mjs";

const defaults = JSON.parse(await readFile(new URL("../config.defaults.json", import.meta.url), "utf8"));

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
    "export const adapterApiVersion = 2;",
    "export function describeRequirements() { return { required: [], description: 'External fixture.' }; }",
    "export function prepareBinding() { return { context: {} }; }",
    "export function projectBinding() { return { status: 'external' }; }",
  ].join("\n"));
  return modulePath;
}

test("a fresh installation describes local selection without creating config or state", async (t) => {
  const item = await fixture(t);
  assert.deepEqual(await readConfig({ environment: item.environment }), defaults);
  assert.equal((await item.cli(["describe"])).adapter, "local");
  assert.equal((await item.cli(["describe", "--adapter", "local"])).adapter, "local");
  await assert.rejects(item.cli(["describe", "--adapter", "other"]), { code: "ADAPTER_MISMATCH" });
  assert.deepEqual(await readdir(item.root), []);
});

test("explicit local configuration is minimal, private, and reloadable", async (t) => {
  const item = await fixture(t);
  const result = await item.cli(["configure", "--adapter", "local"]);
  assert.deepEqual(result, { ok: true, adapter: "local", configPath: item.configPath });
  assert.deepEqual(JSON.parse(await readFile(item.configPath, "utf8")), defaults);
  assert.equal((await stat(item.configPath)).mode & 0o777, 0o600);
  assert.deepEqual(await readConfig({ environment: item.environment }), defaults);
  assert.deepEqual((await configureLocal({ environment: item.environment })).config, defaults);
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
    ["configure", "--adapter", "fixture"],
    ["configure", "--module", "/adapter.mjs"],
    ["configure", "--adapter", "local", "--module"],
    ["configure", "--adapter", "local", "--directory", item.root],
    ["configure", "--adapter", "local", "--adapter", "fixture"],
  ]) await assert.rejects(item.cli(argv), { code: "ARGUMENT_INVALID" });
  assert.deepEqual(await readdir(item.root), []);
});

test("an external adapter named local remains an external integration", async (t) => {
  const item = await fixture(t);
  const modulePath = await externalModule(item.root);
  assert.deepEqual(await item.cli(["configure", "--adapter", "local", "--module", modulePath]), {
    ok: true, adapter: "local", module: modulePath, configPath: item.configPath,
  });
  assert.deepEqual(await readConfig({ environment: item.environment }), {
    schemaVersion: 3, local: { enabled: true, directory: null }, host: { enabled: true, name: "local", module: modulePath },
  });
  const described = await item.cli(["describe", "--adapter", "local"]);
  assert.equal(described.adapter, "local");
  assert.equal(described.selection.description, "External fixture.");
  assert.deepEqual(described.selection.required, ["project", "task"]);
  const marked = await item.cli(["mark", "--adapter", "local", "--selection-json", '{"project":"website","task":"external-task"}'], "external-local");
  assert.deepEqual(marked.target, { kind: "session-marking/target-v1", project: "website", task: "external-task" });
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
  const externalArgs = ["mark", "--selection-json", '{"project":"website","task":"external-task"}'];
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

test("configure initializes shipped defaults privately and preserves existing bytes and partial overrides", async (t) => {
  const item = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => item.cli(["configure"])));
  for (const result of results) assert.deepEqual(result, { ok: true, configPath: item.configPath, config: defaults });
  assert.equal((await stat(item.configPath)).mode & 0o777, 0o600);
  const source = '{ "schemaVersion": 3, "host": {"enabled": false} }\n';
  await writeFile(item.configPath, source);
  assert.deepEqual((await item.cli(["configure"])).config, defaults);
  assert.equal(await readFile(item.configPath, "utf8"), source);
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("legacy configs normalize without rewriting and retain registration response compatibility", async (t) => {
  const item = await fixture(t);
  await mkdir(item.environment.SESSION_MARKING_CONFIG_DIR);
  const modulePath = await externalModule(item.root);
  for (const config of [
    { schemaVersion: 2, mode: "local" },
    { schemaVersion: 1, adapter: { name: "fixture", module: modulePath } },
  ]) {
    const source = JSON.stringify(config);
    await writeFile(item.configPath, source);
    const result = await item.cli(["configure"]);
    assert.equal(result.config.schemaVersion, 3);
    assert.equal(result.config.local.enabled, true);
    assert.equal(result.config.host.enabled, config.schemaVersion === 1);
    assert.equal(await readFile(item.configPath, "utf8"), source);
  }
  assert.deepEqual(await item.cli(["configure", "--adapter", "fixture", "--module", modulePath]), {
    ok: true, adapter: "fixture", module: modulePath, configPath: item.configPath,
  });
});

test("schema-three output fields reject unknown keys and non-booleans before marking", async (t) => {
  const item = await fixture(t);
  await mkdir(item.environment.SESSION_MARKING_CONFIG_DIR);
  const invalid = [
    { schemaVersion: 3, extra: true },
    { schemaVersion: 3, local: null },
    { schemaVersion: 3, local: [] },
    { schemaVersion: 3, host: null },
    { schemaVersion: 3, host: { extra: true } },
    { schemaVersion: 3, local: { extra: true } },
    ...[null, 0, 1, "false", "true", [], {}].flatMap((enabled) => [
      { schemaVersion: 3, local: { enabled } }, { schemaVersion: 3, host: { enabled } },
    ]),
    { schemaVersion: 3, host: { enabled: true } },
    { schemaVersion: 3, host: { name: 1 } },
    { schemaVersion: 3, host: { name: "INVALID" } },
    { schemaVersion: 3, host: { module: "relative.mjs" } },
    { schemaVersion: 3, host: { module: false } },
    { schemaVersion: 3, local: { enabled: false }, host: { enabled: false } },
    JSON.parse('{"schemaVersion":3,"__proto__":{}}'),
    JSON.parse('{"schemaVersion":3,"local":{"__proto__":{}}}'),
    JSON.parse('{"schemaVersion":3,"host":{"__proto__":{}}}'),
  ];
  for (const config of invalid) {
    const source = JSON.stringify(config);
    await writeFile(item.configPath, source);
    await assert.rejects(item.cli(["mark", "--selection-json", '{"project":"website","task":"fix-login"}'], "invalid-config"), { code: "CONFIG_INVALID" }, source);
    await assert.rejects(item.cli(["configure"]), { code: "CONFIG_INVALID" }, source);
    assert.equal(await readFile(item.configPath, "utf8"), source);
  }
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("disabled host settings are retained without importing or requiring the module", async (t) => {
  const item = await fixture(t);
  await mkdir(item.environment.SESSION_MARKING_CONFIG_DIR);
  const modulePath = path.join(item.root, "disabled.mjs");
  const sentinelPath = path.join(item.root, "imported.txt");
  await writeFile(modulePath, `import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(sentinelPath)}, 'bad'); throw Error('disabled');`);
  const config = { schemaVersion: 3, host: { enabled: false, name: "fixture", module: modulePath } };
  await writeFile(item.configPath, JSON.stringify(config));
  assert.equal((await item.cli(["describe"])).adapter, "local");
  await assert.rejects(stat(sentinelPath), { code: "ENOENT" });
  await rm(modulePath);
  assert.equal((await item.cli(["describe"])).adapter, "local");
  const marked = await item.cli(["mark", "--selection-json", '{"project":"website","task":"fix-login"}'], "disabled-host");
  assert.deepEqual(marked.local, { bindingPath: marked.bindingPath });
  assert.equal(marked.projection, null);
  assert.equal((await item.cli(["configure"])).config.host.module, modulePath);
});

test("explicit reconfiguration recovers a moved host while preserving disabled local output", async (t) => {
  const item = await fixture(t);
  await mkdir(item.environment.SESSION_MARKING_CONFIG_DIR);
  const missingModule = path.join(item.root, "missing.mjs");
  await writeFile(item.configPath, JSON.stringify({ schemaVersion: 3, local: { enabled: false }, host: { enabled: true, name: "fixture", module: missingModule } }));
  await assert.rejects(item.cli(["describe"]), { code: "ADAPTER_INVALID" });
  const modulePath = await externalModule(item.root);
  await item.cli(["configure", "--adapter", "fixture", "--module", modulePath]);
  assert.equal((await item.cli(["configure"])).config.local.enabled, false);
  await rm(modulePath);
  await item.cli(["configure", "--adapter", "local"]);
  assert.deepEqual((await item.cli(["configure"])).config, {
    schemaVersion: 3, local: { enabled: true, directory: null }, host: { enabled: false, name: "fixture", module: modulePath },
  });
  assert.equal((await item.cli(["describe"])).adapter, "local");
});

test("configured local directory owns the binding and preserves immutable retries without a default store", async (t) => {
  const item = await fixture(t);
  delete item.environment.SESSION_MARKING_STATE_DIR;
  const directory = path.join(item.root, "custom-local");
  await mkdir(path.dirname(item.configPath));
  await writeFile(item.configPath, JSON.stringify({ schemaVersion: 3, local: { directory } }));
  const args = ["mark", "--selection-json", '{"project":"website","task":"fix-login"}'];
  const first = await item.cli(args, "custom-session");
  const bindingPath = path.join(directory, "bindings", "codex", "custom-session.json");
  assert.equal(first.bindingPath, bindingPath);
  assert.deepEqual(first.local, { bindingPath });
  const source = await readFile(bindingPath, "utf8");
  assert.equal((await item.cli(args, "custom-session")).binding, "existing");
  await assert.rejects(item.cli(["mark", "--selection-json", '{"project":"website","task":"another-task"}'], "custom-session"), { code: "BINDING_CONFLICT" });
  assert.equal(await readFile(bindingPath, "utf8"), source);
  await assert.rejects(stat(stateDirectory(item.environment)), { code: "ENOENT" });
  assert.equal(item.environment.SESSION_MARKING_STATE_DIR, undefined);
});

test("the state environment override wins over local.directory without creating the configured store", async (t) => {
  const item = await fixture(t);
  const directory = path.join(item.root, "custom-local");
  await mkdir(path.dirname(item.configPath));
  await writeFile(item.configPath, JSON.stringify({ schemaVersion: 3, local: { directory } }));
  const result = await item.cli(["mark", "--selection-json", '{"project":"website","task":"fix-login"}'], "environment-override");
  assert.equal(result.bindingPath, path.join(item.environment.SESSION_MARKING_STATE_DIR, "bindings", "codex", "environment-override.json"));
  await assert.rejects(stat(directory), { code: "ENOENT" });
  assert.equal((await item.cli(["configure"])).config.local.directory, directory);
});

test("missing, partial, and legacy local directory settings use the existing platform store", async (t) => {
  const item = await fixture(t);
  delete item.environment.SESSION_MARKING_STATE_DIR;
  const modulePath = await externalModule(item.root);
  const configurations = [
    null,
    { schemaVersion: 3 },
    { schemaVersion: 3, local: { enabled: true } },
    { schemaVersion: 3, local: { directory: null } },
    { schemaVersion: 2, mode: "local" },
    { schemaVersion: 1, adapter: { name: "fixture", module: modulePath } },
  ];
  for (const [index, config] of configurations.entries()) {
    if (config) {
      await mkdir(path.dirname(item.configPath), { recursive: true });
      await writeFile(item.configPath, JSON.stringify(config));
    }
    const sessionId = `fallback-${index}`;
    const selection = config?.schemaVersion === 1 ? '{"project":"website","task":"external-task"}' : '{"project":"website","task":"fix-login"}';
    const marked = await item.cli(["mark", "--selection-json", selection], sessionId);
    assert.equal(marked.bindingPath, path.join(stateDirectory(item.environment), "bindings", "codex", `${sessionId}.json`));
    assert.equal((await readConfig({ environment: item.environment })).local.directory, null);
    if (config) assert.equal(await readFile(item.configPath, "utf8"), JSON.stringify(config));
  }
});

test("invalid local directory settings fail before marking even when an environment override exists", async (t) => {
  const item = await fixture(t);
  await mkdir(path.dirname(item.configPath));
  for (const directory of [false, 1, [], {}, "", "relative", "~/local", path.parse(item.root).root, `${path.parse(item.root).root}child${path.sep}..`, `${item.root}\0invalid`]) {
    await writeFile(item.configPath, JSON.stringify({ schemaVersion: 3, local: { directory } }));
    await assert.rejects(item.cli(["mark", "--selection-json", '{"project":"website","task":"fix-login"}'], "invalid-directory"), { code: "CONFIG_INVALID" });
  }
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("local and host configuration updates preserve a custom local directory", async (t) => {
  const item = await fixture(t);
  const directory = path.join(item.root, "custom-local");
  const modulePath = await externalModule(item.root);
  await mkdir(path.dirname(item.configPath));
  await writeFile(item.configPath, JSON.stringify({ schemaVersion: 3, local: { enabled: false, directory } }));
  await item.cli(["configure", "--adapter", "fixture", "--module", modulePath]);
  assert.deepEqual((await item.cli(["configure"])).config.local, { enabled: false, directory });
  await item.cli(["configure", "--adapter", "local"]);
  assert.deepEqual((await item.cli(["configure"])).config.local, { enabled: true, directory });
});

test("selected unsafe local directories fail without falling back or writing a binding", async (t) => {
  const item = await fixture(t);
  delete item.environment.SESSION_MARKING_STATE_DIR;
  const directory = path.join(item.root, "linked-local");
  const actualDirectory = path.join(item.root, "actual-local");
  await mkdir(actualDirectory);
  await symlink(actualDirectory, directory);
  await mkdir(path.dirname(item.configPath));
  await writeFile(item.configPath, JSON.stringify({ schemaVersion: 3, local: { directory } }));
  await assert.rejects(item.cli(["mark", "--selection-json", '{"project":"website","task":"fix-login"}'], "unsafe-directory"), { code: "PATH_UNSAFE" });
  assert.deepEqual(await readdir(actualDirectory), []);
  await assert.rejects(stat(stateDirectory(item.environment)), { code: "ENOENT" });
});
