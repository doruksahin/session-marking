import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../scripts/session-marking.mjs";
import { configureAdapter } from "../src/config.mjs";
import { markCurrentSession } from "../src/mark.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "local-session-marking-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environment = {
    ...process.env,
    HOME: root,
    SESSION_MARKING_CONFIG_DIR: path.join(root, "config"),
    SESSION_MARKING_STATE_DIR: path.join(root, "state"),
  };
  delete environment.CODEX_THREAD_ID;
  delete environment.CODEX_SESSION_ID;
  delete environment.CLAUDE_CODE_SESSION_ID;
  return { root, environment };
}

function sessionEnvironment(item, provider = "codex", id = "local-session") {
  return provider === "codex"
    ? { ...item.environment, CODEX_THREAD_ID: id, CODEX_SESSION_ID: id }
    : { ...item.environment, CLAUDE_CODE_SESSION_ID: id };
}

function mark(item, selection, environment = sessionEnvironment(item), extraArgs = []) {
  return runCli({
    argv: ["mark", "--selection-json", JSON.stringify(selection), ...extraArgs],
    environment,
    cwd: item.root,
  });
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(target));
    else files.push(target);
  }
  return files.sort();
}

async function configureExternal(item, name = "fixture") {
  const modulePath = path.join(item.root, "adapter.mjs");
  const projectionPath = path.join(item.root, "projected.json");
  await writeFile(modulePath, [
    "import { writeFile } from 'node:fs/promises';",
    "export const adapterApiVersion = 1;",
    "export function describeSelection() { return { type: 'object', required: ['work'] }; }",
    "export function resolveTarget({ selection }) { return { target: { work: selection.work }, context: {} }; }",
    `export async function projectBinding(input) { const { binding, bindingPersisted = true } = input; const expected = bindingPersisted ? ['binding', 'context'] : ['binding', 'bindingPersisted', 'context']; if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expected)) throw Error('unexpected projection fields'); await writeFile(${JSON.stringify(projectionPath)}, JSON.stringify(binding)); return { status: 'projected', bindingPersisted }; }`,
  ].join("\n"));
  await configureAdapter({ name, modulePath, environment: item.environment });
  return projectionPath;
}

for (const provider of ["codex", "claude-code"]) {
  test(`fresh ${provider} usage requires no configuration and writes only its canonical binding`, async (t) => {
    const item = await fixture(t);
    const result = await mark(item, { project: "website", task: "fix-login" }, sessionEnvironment(item, provider));
    const bindingPath = path.join(item.environment.SESSION_MARKING_STATE_DIR, "bindings", provider, "local-session.json");
    assert.equal(result.adapter, "local");
    assert.equal(result.provider, provider);
    assert.equal(result.binding, "created");
    assert.equal(result.bindingPath, bindingPath);
    assert.deepEqual(result.local, { bindingPath });
    assert.equal(result.projection, null);
    assert.deepEqual(result.target, { kind: "local/project-task-v1", project: "website", task: "fix-login" });
    assert.deepEqual(await filesBelow(item.root), [bindingPath]);
    const binding = JSON.parse(await readFile(bindingPath, "utf8"));
    assert.equal(binding.schemaVersion, 2);
    assert.deepEqual(binding.target, result.target);
    assert.equal(binding.session.id, result.sessionId);
    assert.equal(binding.session.url, provider === "codex" ? "codex://threads/local-session" : null);
    assert.equal((await stat(bindingPath)).mode & 0o777, 0o600);
  });
}

test("local retries preserve the first observation and reject another target", async (t) => {
  const item = await fixture(t);
  const firstDirectory = await realpath(await mkdtemp(path.join(item.root, "first-")));
  const secondDirectory = await realpath(await mkdtemp(path.join(item.root, "second-")));
  const selection = { project: "website", task: "fix-login" };
  const input = { selection, environment: sessionEnvironment(item), workingDirectory: firstDirectory, now: () => new Date("2026-09-13T10:00:00.000Z") };
  const first = await markCurrentSession(input);
  const original = await readFile(first.bindingPath, "utf8");
  const retry = await markCurrentSession({ ...input, workingDirectory: secondDirectory, now: () => new Date("2026-09-13T11:00:00.000Z") });
  assert.equal(retry.binding, "existing");
  assert.equal(retry.bindingPath, first.bindingPath);
  assert.equal(retry.projection, null);
  await assert.rejects(mark(item, { ...selection, task: "other-task" }), { code: "BINDING_CONFLICT" });
  assert.equal(await readFile(first.bindingPath, "utf8"), original);
});

test("local selections are explicit, exact, and bounded before claiming", async (t) => {
  const item = await fixture(t);
  const invalidSelections = [
    { task: "fix-login" },
    { project: "website" },
    { project: "website", task: "fix-login", extra: true },
    { jiraKey: "EXAMPLE-1", stageId: "implementation" },
    JSON.parse('{"project":"website","task":"fix-login","__proto__":{"extra":true}}'),
    ...["project", "task"].flatMap((field) => ["", " ", " leading", "trailing ", "x".repeat(257), 42, null].map((value) => ({ project: "website", task: "fix-login", [field]: value }))),
  ];
  for (const selection of invalidSelections) {
    await assert.rejects(mark(item, selection), { code: "SELECTION_INVALID" });
  }
  assert.deepEqual(await filesBelow(item.root), []);
  const result = await mark(item, { project: "a", task: "x".repeat(256) });
  assert.equal(result.target.task.length, 256);
});

test("local marking requires provider identity and respects the adapter guard", async (t) => {
  const item = await fixture(t);
  const selection = { project: "website", task: "fix-login" };
  await assert.rejects(mark(item, selection, item.environment), { code: "SESSION_ID_UNAVAILABLE" });
  await assert.rejects(mark(item, selection, { ...sessionEnvironment(item), CLAUDE_CODE_SESSION_ID: "other" }), { code: "SESSION_PROVIDER_AMBIGUOUS" });
  await assert.rejects(mark(item, selection, sessionEnvironment(item), ["--adapter", "fixture"]), { code: "ADAPTER_MISMATCH" });
  assert.deepEqual(await filesBelow(item.root), []);
  const result = await mark(item, selection, sessionEnvironment(item), ["--adapter", "local"]);
  assert.equal(result.binding, "created");
});

test("an external adapter named local still projects exactly its own target and canonical claim", async (t) => {
  const item = await fixture(t);
  const projectionPath = await configureExternal(item, "local");
  const result = await mark(item, { work: "host-task" }, sessionEnvironment(item), ["--adapter", "local"]);
  assert.deepEqual(result.target, { work: "host-task" });
  assert.deepEqual(result.projection, { status: "projected", bindingPersisted: true });
  const canonical = JSON.parse(await readFile(result.bindingPath, "utf8"));
  assert.deepEqual(JSON.parse(await readFile(projectionPath, "utf8")), canonical);
  assert.deepEqual(await filesBelow(item.environment.SESSION_MARKING_STATE_DIR), [result.bindingPath]);
});

test("external JSON target keys remain own properties without changing the object prototype", async (t) => {
  const item = await fixture(t);
  const modulePath = path.join(item.root, "adapter.mjs");
  await writeFile(modulePath, [
    "export const adapterApiVersion = 1;",
    "export function describeSelection() { return { type: 'object' }; }",
    "export function resolveTarget({ selection }) { if (Object.getPrototypeOf(selection) !== Object.prototype || !Object.hasOwn(selection, '__proto__')) throw new Error('selection key lost'); return { target: selection, context: {} }; }",
    "export function projectBinding({ binding }) { if (Object.getPrototypeOf(binding.target) !== Object.prototype || !Object.hasOwn(binding.target, '__proto__')) throw new Error('target key lost'); return { status: 'projected' }; }",
  ].join("\n"));
  await configureAdapter({ name: "fixture", modulePath, environment: item.environment });
  const selection = JSON.parse('{"work":"host-task","__proto__":{"extra":true}}');
  const first = await mark(item, selection);
  assert.deepEqual(first.target, selection);
  const original = await readFile(first.bindingPath, "utf8");
  assert.deepEqual(JSON.parse(original).target, selection);
  const retry = await mark(item, selection);
  assert.equal(retry.binding, "existing");
  await assert.rejects(mark(item, JSON.parse('{"work":"host-task","__proto__":{"extra":false}}')), { code: "BINDING_CONFLICT" });
  assert.equal(await readFile(first.bindingPath, "utf8"), original);
});

test("switching mode preserves existing bindings and never broadcasts to the former host", async (t) => {
  const item = await fixture(t);
  const projectionPath = await configureExternal(item);
  const external = await mark(item, { work: "host-task" });
  const originalClaim = await readFile(external.bindingPath, "utf8");
  const originalProjection = await readFile(projectionPath, "utf8");
  await runCli({ argv: ["configure", "--adapter", "local"], environment: item.environment, cwd: item.root });
  await assert.rejects(mark(item, { project: "website", task: "fix-login" }), { code: "BINDING_CONFLICT" });
  const local = await mark(item, { project: "website", task: "fix-login" }, sessionEnvironment(item, "codex", "new-session"));
  assert.equal(local.projection, null);
  assert.equal(await readFile(projectionPath, "utf8"), originalProjection);
  assert.equal(await readFile(external.bindingPath, "utf8"), originalClaim);
  const localClaim = await readFile(local.bindingPath, "utf8");
  await configureExternal(item);
  await assert.rejects(mark(item, { work: "host-task" }, sessionEnvironment(item, "codex", "new-session")), { code: "BINDING_CONFLICT" });
  assert.equal(await readFile(local.bindingPath, "utf8"), localClaim);
  assert.equal(await readFile(projectionPath, "utf8"), originalProjection);
});

for (const provider of ["codex", "claude-code"]) {
  test(`${provider} disabling local leaves its existing binding untouched and gives the host a fresh candidate`, async (t) => {
    const item = await fixture(t);
    const projectionPath = await configureExternal(item);
    const environment = sessionEnvironment(item, provider, "shared-output");
    const selection = { work: "host-task" };
    const result = await mark(item, selection, environment, ["--adapter", "fixture"]);
    assert.deepEqual(result.local, { bindingPath: result.bindingPath });
    assert.equal(result.projection.bindingPersisted, true);
    assert.deepEqual(result.target, { work: "host-task" });
    const original = await readFile(result.bindingPath, "utf8");
    assert.deepEqual(JSON.parse(await readFile(projectionPath, "utf8")), JSON.parse(original));

    const configPath = path.join(item.environment.SESSION_MARKING_CONFIG_DIR, "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.local.enabled = false;
    await writeFile(configPath, JSON.stringify(config));
    await rm(projectionPath);
    const retry = await mark(item, selection, environment);
    assert.equal(retry.local, null);
    assert.equal(retry.binding, null);
    assert.equal(retry.bindingPath, null);
    assert.equal(retry.projection.bindingPersisted, false);
    assert.deepEqual(JSON.parse(await readFile(projectionPath, "utf8")).target, JSON.parse(original).target);
    assert.equal(await readFile(result.bindingPath, "utf8"), original);
    assert.deepEqual((await mark(item, { work: "other-task" }, environment)).target, { work: "other-task" });
    await assert.rejects(mark(item, selection, environment, ["--adapter", "local"]), { code: "ADAPTER_MISMATCH" });
    assert.deepEqual(await filesBelow(item.environment.SESSION_MARKING_STATE_DIR), [result.bindingPath]);
  });
}

test("host-only projection failure creates no local claim and a later invocation can retry the host", async (t) => {
  const item = await fixture(t);
  const projectionPath = await configureExternal(item);
  const configPath = path.join(item.environment.SESSION_MARKING_CONFIG_DIR, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.local.enabled = false;
  await writeFile(configPath, JSON.stringify(config));
  await mkdir(projectionPath);
  const selection = { work: "repair-task" };
  await assert.rejects(mark(item, selection), { code: "EISDIR" });
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
  await rm(projectionPath, { recursive: true });
  const result = await mark(item, selection);
  assert.equal(result.binding, null);
  assert.equal(result.bindingPath, null);
  assert.equal(result.local, null);
  assert.equal(result.projection.bindingPersisted, false);
  assert.deepEqual(JSON.parse(await readFile(projectionPath, "utf8")).target, result.target);
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("host-only marking never reads or writes a disabled local store, including unsafe paths", async (t) => {
  const item = await fixture(t);
  await configureExternal(item);
  const configPath = path.join(item.environment.SESSION_MARKING_CONFIG_DIR, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.local.enabled = false;
  const missing = path.join(item.root, "missing-local");
  const actual = path.join(item.root, "actual-local");
  const linked = path.join(item.root, "linked-local");
  await mkdir(actual);
  await symlink(actual, linked);
  const blocked = path.join(item.root, "file-local");
  await writeFile(blocked, "keep me unchanged");
  for (const directory of [missing, linked, blocked]) {
    config.local.directory = directory;
    await writeFile(configPath, JSON.stringify(config));
    const environment = sessionEnvironment(item);
    delete environment.SESSION_MARKING_STATE_DIR;
    const result = await mark(item, { work: "host-task" }, environment);
    assert.equal(result.binding, null);
    assert.equal(result.bindingPath, null);
    assert.equal(result.local, null);
    assert.equal(result.projection.bindingPersisted, false);
  }
  const result = await mark(item, { work: "host-task" }, { ...sessionEnvironment(item), SESSION_MARKING_STATE_DIR: "relative-and-unused" });
  assert.equal(result.local, null);
  await assert.rejects(stat(missing), { code: "ENOENT" });
  assert.deepEqual(await readdir(actual), []);
  assert.equal(await readFile(blocked, "utf8"), "keep me unchanged");
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});
