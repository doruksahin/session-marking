import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../scripts/session-marking.mjs";
import { createBinding, renderBinding } from "../src/binding.mjs";
import { configureAdapter } from "../src/config.mjs";
import { markSession } from "../src/mark.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "session-description-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environment = { HOME: root, SESSION_MARKING_CONFIG_DIR: path.join(root, "config"), SESSION_MARKING_STATE_DIR: path.join(root, "state") };
  const cli = (argv, id = "described-session") => runCli({ argv, cwd: root, environment: { ...environment, CODEX_THREAD_ID: id, CODEX_SESSION_ID: id } });
  return { root, environment, cli };
}

const selection = { project: "website", task: "fix-login", stageId: "implementation" };
const markArgs = ["mark", "--selection-json", JSON.stringify(selection)];

test("mark saves and returns exact description text separately from the target", async (t) => {
  const item = await fixture(t);
  const description = '  Login repair: "cookie expiry"\r\nSecond line.  ';
  const result = await item.cli([...markArgs, "--description", description]);
  const binding = JSON.parse(await readFile(result.bindingPath, "utf8"));
  assert.equal(result.description, description);
  assert.equal(binding.description, description);
  assert.deepEqual(binding.target, { kind: "session-marking/target-v1", ...selection });
  assert.deepEqual(result.target, binding.target);
  assert.equal(Object.hasOwn(result.target, "description"), false);
  assert.deepEqual((await item.cli(["list", "--filter", `description=${description}`])).sessions, [binding]);
});

test("identical target retries keep the first description, including its absence", async (t) => {
  const item = await fixture(t);
  const first = await item.cli([...markArgs, "--description", "Original note"]);
  const original = await readFile(first.bindingPath, "utf8");
  for (const args of [markArgs, [...markArgs, "--description", "Replacement note"]]) {
    const retry = await item.cli(args);
    assert.equal(retry.binding, "existing");
    assert.equal(retry.description, "Original note");
    assert.equal(await readFile(first.bindingPath, "utf8"), original);
  }

  const absent = await item.cli(markArgs, "without-description");
  const absentSource = await readFile(absent.bindingPath, "utf8");
  const retry = await item.cli([...markArgs, "--description", "Cannot add a later observation"], "without-description");
  assert.equal(retry.binding, "existing");
  assert.equal(Object.hasOwn(retry, "description"), false);
  assert.equal(await readFile(absent.bindingPath, "utf8"), absentSource);
  await assert.rejects(item.cli(["mark", "--selection-json", JSON.stringify({ ...selection, task: "other-task" }), "--description", "Original note"]), { code: "BINDING_CONFLICT" });
});

test("omitting description preserves the original binding shape and rendering", async (t) => {
  const item = await fixture(t);
  const result = await item.cli(markArgs);
  const source = await readFile(result.bindingPath, "utf8");
  const saved = JSON.parse(source);
  assert.equal(Object.hasOwn(result, "description"), false);
  assert.deepEqual(Object.keys(saved), ["schemaVersion", "session", "target", "markedAt", "workingDirectory"]);
  assert.equal(renderBinding(createBinding(saved)), source);
  const listed = await item.cli(["list", "--filter", "description=missing"]);
  assert.deepEqual(listed.sessions, []);
});

test("empty description is explicit and descriptions sort as text with missing values last", async (t) => {
  const item = await fixture(t);
  const empty = await item.cli([...markArgs, "--description", ""], "empty");
  assert.equal(empty.description, "");
  await item.cli([...markArgs, "--description", "Zebra"], "zebra");
  await item.cli([...markArgs, "--description", "Apple"], "apple");
  await item.cli(markArgs, "missing");
  assert.deepEqual((await item.cli(["list", "--filter", "description="])).sessions.map((binding) => binding.session.id), ["empty"]);
  assert.deepEqual((await item.cli(["list", "--sort", "description"])).sessions.map((binding) => binding.session.id), ["empty", "apple", "zebra", "missing"]);
  assert.deepEqual((await item.cli(["list", "--sort", "description", "--order", "desc"])).sessions.map((binding) => binding.session.id), ["zebra", "apple", "empty", "missing"]);
});

test("description uses the existing string bound and escaped records remain readable", async (t) => {
  const item = await fixture(t);
  const input = {
    selection: { project: "\0".repeat(256), task: "\0".repeat(256) },
    environment: { ...item.environment, CODEX_THREAD_ID: "bounded", CODEX_SESSION_ID: "bounded" },
    workingDirectory: item.root,
  };
  for (const description of [null, false, 12, {}]) {
    await assert.rejects(markSession({ ...input, description }), { code: "BINDING_INVALID" });
  }
  await assert.rejects(markSession({ ...input, description: "x".repeat(16 * 1024) }), { code: "JSON_INVALID" });
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
  const description = '"'.repeat(8191);
  assert.equal(Buffer.byteLength(JSON.stringify(description)), 16 * 1024);
  const result = await markSession({ ...input, description });
  const source = await readFile(result.bindingPath, "utf8");
  assert.ok(Buffer.byteLength(source) < 64 * 1024);
  assert.equal((await item.cli(["list"])).sessions[0].description, description);
});

test("host projection receives observation metadata and host-only marking leaves storage untouched", async (t) => {
  const item = await fixture(t);
  const modulePath = path.join(item.root, "adapter.mjs");
  await writeFile(modulePath, [
    "export const adapterApiVersion = 2;",
    "export function describeRequirements() { return { required: [], description: '' }; }",
    "export function prepareBinding() { return { context: {} }; }",
    "export function projectBinding({ binding }) { return { description: binding.description }; }",
  ].join("\n"));
  await configureAdapter({ name: "fixture", modulePath, environment: item.environment });
  const configPath = path.join(item.environment.SESSION_MARKING_CONFIG_DIR, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.local.enabled = false;
  await writeFile(configPath, JSON.stringify(config));
  const result = await item.cli([...markArgs, "--description", "Host-only note"]);
  assert.equal(result.description, "Host-only note");
  assert.equal(result.projection.description, "Host-only note");
  assert.equal(result.local, null);
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("mark help advertises description and its flag remains optional, singular, and separate from selection", async (t) => {
  const item = await fixture(t);
  const help = await item.cli(["mark", "--help"]);
  assert.match(help, /\[--description <text>\]/);
  assert.match(help, /first description/);
  for (const args of [
    [...markArgs, "--description"],
    [...markArgs, "--description", "one", "--description", "two"],
    ["mark", "--description", "note"],
    ["list", "--description", "note"],
    ["mark", "--selection-json", ""],
  ]) await assert.rejects(item.cli(args), { code: "ARGUMENT_INVALID" });
  await assert.rejects(item.cli(["mark", "--selection-json", JSON.stringify({ ...selection, description: "wrong location" })]), { code: "SELECTION_INVALID" });
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});
