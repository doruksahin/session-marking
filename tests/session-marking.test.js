import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { createBinding } from "../src/binding.mjs";
import { configureAdapter } from "../src/config.mjs";
import { markCurrentSession } from "../src/mark.mjs";
import { runCli } from "../scripts/session-marking.mjs";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../scripts/session-marking.mjs", import.meta.url));

async function fixture(t, adapterSource) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "portable-session-marking-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = path.join(root, "config");
  const state = path.join(root, "state");
  const modulePath = path.join(root, "adapter.mjs");
  await writeFile(modulePath, adapterSource || [
    "export const adapterApiVersion = 1;",
    "export async function describeSelection() { return { type: 'object' }; }",
    "export async function resolveTarget({ selection }) { return { target: selection, context: { selection } }; }",
    `export async function projectBinding({ binding }) { return { status: 'projected', markedAt: binding.markedAt }; }`,
  ].join("\n"));
  const environment = { ...process.env, HOME: root, SESSION_MARKING_CONFIG_DIR: config, SESSION_MARKING_STATE_DIR: state };
  delete environment.CODEX_THREAD_ID;
  delete environment.CODEX_SESSION_ID;
  delete environment.CLAUDE_CODE_SESSION_ID;
  await configureAdapter({ name: "fixture", modulePath, environment });
  return { root, config, state, modulePath, environment };
}

function codex(environment, id) {
  return { ...environment, CODEX_THREAD_ID: id, CODEX_SESSION_ID: id };
}

test("configuration is private and contains one canonical adapter", async (t) => {
  const item = await fixture(t);
  const configPath = path.join(item.config, "config.json");
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(Object.keys(config), ["schemaVersion", "local", "host"]);
  assert.equal(config.host.name, "fixture");
  assert.equal(config.host.module, item.modulePath);
});

test("describe exposes the configured adapter selection without requiring a session", async (t) => {
  const item = await fixture(t);
  const result = await runCli({ argv: ["describe"], environment: item.environment, cwd: item.root });
  assert.equal(result.adapter, "fixture");
  assert.equal(result.selection.type, "object");
});

test("CLI executes through a symlinked installation path", async (t) => {
  const item = await fixture(t);
  const linkedCli = path.join(item.root, "session-marking-link.mjs");
  await symlink(cliPath, linkedCli);
  const { stdout, stderr } = await execFileAsync(process.execPath, [linkedCli, "describe"], { env: item.environment, cwd: item.root });
  assert.equal(stderr, "");
  assert.equal(JSON.parse(stdout).adapter, "fixture");
});

test("identical retries keep the first observation even from another directory", async (t) => {
  const item = await fixture(t);
  const firstDirectory = await realpath(await mkdtemp(path.join(item.root, "first-")));
  const secondDirectory = await realpath(await mkdtemp(path.join(item.root, "second-")));
  const first = await markCurrentSession({ selection: { work: "A" }, environment: codex(item.environment, "same-session"), workingDirectory: firstDirectory, now: () => new Date("2026-08-26T10:00:00.000Z") });
  const second = await markCurrentSession({ selection: { work: "A" }, environment: codex(item.environment, "same-session"), workingDirectory: secondDirectory, now: () => new Date("2026-08-26T11:00:00.000Z") });
  assert.equal(first.binding, "created");
  assert.equal(second.binding, "existing");
  assert.equal(second.projection.markedAt, "2026-08-26T10:00:00.000Z");
  const binding = JSON.parse(await readFile(path.join(item.state, "bindings", "codex", "same-session.json"), "utf8"));
  assert.equal(binding.workingDirectory, firstDirectory);
  assert.equal((await stat(path.join(item.state, "bindings", "codex", "same-session.json"))).mode & 0o777, 0o600);
});

test("conflicting concurrent claims have exactly one winner", async (t) => {
  const item = await fixture(t);
  const base = { environment: codex(item.environment, "contended"), workingDirectory: item.root };
  const outcomes = await Promise.allSettled([
    markCurrentSession({ ...base, selection: { work: "A" } }),
    markCurrentSession({ ...base, selection: { work: "B" } }),
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
  const rejected = outcomes.find((entry) => entry.status === "rejected");
  assert.equal(rejected.reason.code, "BINDING_CONFLICT");
});

test("many sessions bind independently and provider namespaces isolate equal IDs", async (t) => {
  const item = await fixture(t);
  const jobs = Array.from({ length: 20 }, (_, index) => markCurrentSession({
    selection: { work: index }, environment: codex(item.environment, `parallel-${index}`), workingDirectory: item.root,
  }));
  assert.equal((await Promise.all(jobs)).length, 20);
  const claude = await markCurrentSession({ selection: { work: "claude" }, environment: { ...item.environment, CLAUDE_CODE_SESSION_ID: "parallel-0" }, workingDirectory: item.root });
  assert.equal(claude.provider, "claude-code");
  assert.equal(claude.sessionUrl, null);
});

test("identity is fail-closed and cannot be supplied as command data", async (t) => {
  const item = await fixture(t);
  await assert.rejects(markCurrentSession({ selection: { work: "A" }, environment: item.environment, workingDirectory: item.root }), { code: "SESSION_ID_UNAVAILABLE" });
  await assert.rejects(markCurrentSession({ selection: { work: "A" }, environment: { ...codex(item.environment, "one"), CLAUDE_CODE_SESSION_ID: "two" }, workingDirectory: item.root }), { code: "SESSION_PROVIDER_AMBIGUOUS" });
  const result = await markCurrentSession({ selection: { work: "A", sessionId: "forged" }, environment: codex(item.environment, "real"), workingDirectory: item.root });
  assert.equal(result.sessionId, "real");
  assert.equal(result.target.sessionId, "forged");
});

test("a durable claim survives projection failure and an identical retry repairs it", async (t) => {
  const source = [
    "import { access, writeFile } from 'node:fs/promises';",
    "export const adapterApiVersion = 1;",
    "export async function describeSelection() { return { type: 'object' }; }",
    "export async function resolveTarget({ selection }) { return { target: { work: selection.work }, context: { sentinel: selection.sentinel } }; }",
    "export async function projectBinding({ context }) {",
    "  try { await access(context.sentinel); } catch { await writeFile(context.sentinel, 'retry'); throw new Error('interrupted projection'); }",
    "  return { status: 'repaired' };",
    "}",
  ].join("\n");
  const item = await fixture(t, source);
  const selection = { work: "repair", sentinel: path.join(item.root, "sentinel") };
  const input = { selection, environment: codex(item.environment, "repairable"), workingDirectory: item.root };
  await assert.rejects(markCurrentSession(input), /interrupted projection/);
  const repaired = await markCurrentSession(input);
  assert.equal(repaired.binding, "existing");
  assert.equal(repaired.projection.status, "repaired");
});

test("binding validation rejects unsupported session data", async (t) => {
  const item = await fixture(t);
  assert.throws(() => createBinding({ schemaVersion: 2, session: { provider: "codex", id: "x", url: null }, target: { work: "A" }, markedAt: new Date().toISOString(), workingDirectory: item.root }), { code: "BINDING_INVALID" });
});
