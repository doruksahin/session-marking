import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../scripts/session-marking.mjs";
import { createBinding } from "../src/binding.mjs";
import { configureAdapter } from "../src/config.mjs";
import { markSession } from "../src/mark.mjs";
import { claimBinding } from "../src/store.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "shared-session-target-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root, modules: 0,
    environment: { HOME: root, SESSION_MARKING_CONFIG_DIR: path.join(root, "config"), SESSION_MARKING_STATE_DIR: path.join(root, "state") },
  };
}

async function host(item, { requirements = { required: [], description: "Shared target fixture." }, prepare = "return { context: { transient: 'host-only' } };", version = 2 } = {}) {
  const modulePath = path.join(item.root, `adapter-${item.modules++}.mjs`);
  await writeFile(modulePath, [
    `export const adapterApiVersion = ${version};`,
    `export function describeRequirements() { return ${JSON.stringify(requirements)}; }`,
    `export function prepareBinding({ target, workingDirectory }) { ${prepare} }`,
    "export function projectBinding({ binding, context, bindingPersisted = true }) { return { binding, context, bindingPersisted }; }",
  ].join("\n"));
  await configureAdapter({ name: "fixture", modulePath, environment: item.environment });
}

function cli(item, argv, provider = "codex", id = "shared-session") {
  const identity = provider === "codex" ? { CODEX_THREAD_ID: id, CODEX_SESSION_ID: id } : { CLAUDE_CODE_SESSION_ID: id };
  return runCli({ argv, environment: { ...item.environment, ...identity }, cwd: item.root });
}

function mark(item, selection, provider, id) {
  return cli(item, ["mark", "--selection-json", JSON.stringify(selection)], provider, id);
}

for (const provider of ["codex", "claude-code"]) {
  test(`${provider} keeps one target and first observation through local, host, and local again`, async (t) => {
    const item = await fixture(t);
    const selection = { project: "website", task: "fix-login", stageId: "custom-stage" };
    const first = await mark(item, selection, provider);
    const source = await readFile(first.bindingPath, "utf8");
    const original = JSON.parse(source);
    assert.deepEqual(first.target, { kind: "session-marking/target-v1", ...selection });

    await host(item);
    const external = await mark(item, selection, provider);
    assert.equal(external.binding, "existing");
    assert.deepEqual(external.target, first.target);
    assert.deepEqual(external.projection.binding, original);
    assert.deepEqual(external.projection.context, { transient: "host-only" });
    assert.equal(external.projection.bindingPersisted, true);

    await cli(item, ["configure", "--adapter", "local"], provider);
    const local = await mark(item, selection, provider);
    assert.equal(local.binding, "existing");
    assert.equal(local.projection, null);
    assert.deepEqual(local.target, first.target);
    assert.equal(await readFile(first.bindingPath, "utf8"), source);
    await assert.rejects(mark(item, { ...selection, stageId: "other-stage" }, provider), { code: "BINDING_CONFLICT" });
    await assert.rejects(mark(item, { project: selection.project, task: selection.task }, provider), { code: "BINDING_CONFLICT" });
  });
}

test("describe shares core properties with hosts and mark enforces their required stage", async (t) => {
  const item = await fixture(t);
  const local = await cli(item, ["describe"]);
  assert.deepEqual(local.selection.required, ["project", "task"]);
  assert.deepEqual(Object.keys(local.selection.properties), ["project", "task", "stageId"]);
  const withoutStage = await mark(item, { project: "website", task: "fix-login" }, "codex", "optional-stage");
  assert.equal(Object.hasOwn(withoutStage.target, "stageId"), false);

  await host(item, { requirements: { required: ["stageId"], description: "This destination requires a stage." } });
  const external = await cli(item, ["describe"]);
  assert.deepEqual(external.selection.required, ["project", "task", "stageId"]);
  assert.equal(external.selection.description, "This destination requires a stage.");
  assert.deepEqual(external.selection.properties, local.selection.properties);
  const base = { project: "website", task: "fix-login" };
  await assert.rejects(mark(item, base), { code: "SELECTION_INVALID" });
  for (const stageId of ["", "Implementation", " implementation", "implementation ", "1-stage", "stage_id", "x".repeat(65), false]) {
    await assert.rejects(mark(item, { ...base, stageId }), { code: "SELECTION_INVALID" });
  }
  for (const stageId of ["a", "review-stage-2", "x".repeat(64)]) {
    const result = await mark(item, { ...base, stageId }, "codex", stageId);
    assert.equal(result.target.stageId, stageId);
    assert.equal(result.projection.binding.target.stageId, stageId);
  }
});

test("common selection validation runs before host preparation or storage", async (t) => {
  const item = await fixture(t);
  await host(item, { prepare: "throw new Error('preparation must not run for invalid input');" });
  for (const selection of [
    { jiraKey: "EXAMPLE-1", stageId: "implementation" },
    { project: "website" }, { task: "fix-login" },
    { project: " website", task: "fix-login" }, { project: "website", task: "fix-login " },
    { project: "website", task: "fix-login", unknown: true },
    { project: "website", task: "fix-login", kind: "different" },
    { project: "website", task: "fix-login", stageId: "bad_stage" },
  ]) await assert.rejects(mark(item, selection), { code: "SELECTION_INVALID" });
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("adapter requirements cannot add fields or replace the common schema", async (t) => {
  const item = await fixture(t);
  for (const requirements of [
    { required: ["ticket"], description: "Invalid field." },
    { required: ["project"], description: "Already a core requirement." },
    { required: ["stageId", "stageId"], description: "Duplicate." },
    { required: "stageId", description: "Wrong type." },
    { required: [], description: null },
    { required: [], description: "Extra schema.", properties: {} },
  ]) {
    await host(item, { requirements });
    await assert.rejects(cli(item, ["describe"]), { code: "ADAPTER_INVALID" });
    await assert.rejects(mark(item, { project: "website", task: "fix-login" }), { code: "ADAPTER_INVALID" });
  }
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("preparation returns context only and cannot replace or drop target fields", async (t) => {
  const item = await fixture(t);
  for (const prepare of [
    "return { context: {}, target: { project: target.project, task: target.task } };",
    "return { context: {}, legacyTarget: target };",
    "return { context: [] };",
  ]) {
    await host(item, { prepare });
    await assert.rejects(mark(item, { project: "website", task: "fix-login", stageId: "implementation" }), { code: "ADAPTER_INVALID" });
  }
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("unsupported adapter versions fail and existing saved targets remain unchanged and listable", async (t) => {
  const item = await fixture(t);
  await host(item, { version: 1 });
  await assert.rejects(cli(item, ["describe"]), { code: "ADAPTER_INVALID" });
  await cli(item, ["configure", "--adapter", "local"]);
  const existing = createBinding({
    schemaVersion: 2,
    session: { provider: "codex", id: "shared-session", url: "codex://threads/shared-session" },
    target: { kind: "local/project-task-v1", project: "website", task: "fix-login" },
    markedAt: "2026-09-13T10:00:00.000Z", workingDirectory: item.root,
  });
  const claim = await claimBinding(existing, { environment: item.environment });
  const original = await readFile(claim.targetPath, "utf8");
  await assert.rejects(markSession({
    selection: { project: "website", task: "fix-login" },
    environment: { ...item.environment, CODEX_THREAD_ID: "shared-session", CODEX_SESSION_ID: "shared-session" },
    workingDirectory: item.root,
  }), { code: "BINDING_CONFLICT" });
  assert.equal(await readFile(claim.targetPath, "utf8"), original);
  assert.deepEqual((await cli(item, ["list"])).sessions, [existing]);
});
