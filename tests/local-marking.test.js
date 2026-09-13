import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
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
    `export async function projectBinding({ binding }) { await writeFile(${JSON.stringify(projectionPath)}, JSON.stringify(binding)); return { status: 'projected' }; }`,
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
  assert.deepEqual(result.projection, { status: "projected" });
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
