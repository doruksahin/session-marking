import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runCli } from "../scripts/session-marking.mjs";
import { configureAdapter } from "../src/config.mjs";

const execute = promisify(execFile);
const cliPath = fileURLToPath(new URL("../scripts/session-marking.mjs", import.meta.url));
const selection = { project: "website", task: "fix-login", stageId: "implementation" };
const markArgs = ["mark", "--selection-json", JSON.stringify(selection)];

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "explicit-session-identity-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    environment: { HOME: root, SESSION_MARKING_CONFIG_DIR: path.join(root, "config"), SESSION_MARKING_STATE_DIR: path.join(root, "state") },
  };
}

function cli(item, args, identity = {}) {
  return runCli({ argv: args, cwd: item.root, environment: { ...item.environment, ...identity } });
}

function automatic(provider, id) {
  return provider === "codex" ? { CODEX_THREAD_ID: id, CODEX_SESSION_ID: id } : { CLAUDE_CODE_SESSION_ID: id };
}

for (const provider of ["codex", "claude-code"]) {
  test(`${provider} can be marked from the executable without any provider environment`, async (t) => {
    const item = await fixture(t);
    const sessionId = "selected-session";
    const { stdout, stderr } = await execute(process.execPath, [
      cliPath, ...markArgs, "--provider", provider, "--session-id", sessionId, "--description", "Explicit observation",
    ], { env: item.environment, cwd: item.root });
    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    assert.equal(result.provider, provider);
    assert.equal(result.sessionId, sessionId);
    assert.equal(result.sessionUrl, provider === "codex" ? `codex://threads/${sessionId}` : null);
    assert.equal(result.description, "Explicit observation");
    assert.equal(result.bindingPath, path.join(item.environment.SESSION_MARKING_STATE_DIR, "bindings", provider, `${sessionId}.json`));
    const binding = JSON.parse(await readFile(result.bindingPath, "utf8"));
    assert.deepEqual(binding.session, { provider, id: sessionId, url: result.sessionUrl });
    assert.deepEqual(binding.target, { kind: "session-marking/target-v1", ...selection });
    assert.deepEqual(Object.keys(binding), ["schemaVersion", "session", "target", "markedAt", "workingDirectory", "description"]);
    assert.deepEqual((await cli(item, ["list", "--filter", `session.provider=${provider}`])).sessions, [binding]);
  });

  test(`${provider} explicit identity overrides mismatched and ambiguous environment identities`, async (t) => {
    const item = await fixture(t);
    const result = await cli(item, [...markArgs, "--provider", provider, "--session-id", "explicit-wins"], {
      CODEX_THREAD_ID: "different-thread", CODEX_SESSION_ID: "different-session", CLAUDE_CODE_SESSION_ID: "unrelated-claude",
    });
    assert.equal(result.provider, provider);
    assert.equal(result.sessionId, "explicit-wins");
    assert.equal(result.binding, "created");
  });

  test(`${provider} explicit and automatic retries share one immutable record across host switching`, async (t) => {
    const item = await fixture(t);
    const sessionId = "same-record";
    const explicit = [...markArgs, "--provider", provider, "--session-id", sessionId];
    const first = await cli(item, [...explicit, "--description", "First note"]);
    const source = await readFile(first.bindingPath, "utf8");
    const binding = JSON.parse(source);
    const modulePath = path.join(item.root, "adapter.mjs");
    await writeFile(modulePath, [
      "export const adapterApiVersion = 2;",
      "export function describeRequirements() { return { required: [], description: '' }; }",
      "export function prepareBinding() { return { context: {} }; }",
      "export function projectBinding({ binding }) { return { binding }; }",
    ].join("\n"));
    await configureAdapter({ name: "fixture", modulePath, environment: item.environment });
    const auto = await cli(item, [...markArgs, "--description", "Later automatic note"], automatic(provider, sessionId));
    assert.equal(auto.binding, "existing");
    assert.equal(auto.description, "First note");
    assert.deepEqual(auto.projection.binding, binding);
    await cli(item, ["configure", "--adapter", "local"]);
    const again = await cli(item, explicit);
    assert.equal(again.binding, "existing");
    assert.equal(again.projection, null);
    assert.equal(await readFile(first.bindingPath, "utf8"), source);
    await assert.rejects(cli(item, ["mark", "--selection-json", JSON.stringify({ ...selection, task: "other-task" }), "--provider", provider, "--session-id", sessionId]), { code: "BINDING_CONFLICT" });
  });
}

test("partial explicit identity is not completed from the environment and fails before host loading", async (t) => {
  const item = await fixture(t);
  const modulePath = path.join(item.root, "adapter.mjs");
  await writeFile(modulePath, "throw new Error('identity validation must precede this import');");
  await configureAdapter({ name: "fixture", modulePath, environment: item.environment });
  for (const flags of [["--provider", "codex"], ["--session-id", "explicit"]]) {
    await assert.rejects(cli(item, [...markArgs, ...flags], automatic("codex", "current")), (error) => {
      assert.equal(error.code, "ARGUMENT_INVALID");
      assert.match(error.message, /--provider and --session-id together/);
      return true;
    });
  }
  await assert.rejects(execute(process.execPath, [cliPath, ...markArgs, "--provider", "codex"], { env: item.environment }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, "");
    assert.equal(JSON.parse(error.stderr).code, "ARGUMENT_INVALID");
    return true;
  });
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("invalid explicit providers, IDs, and option structures fail without creating a binding", async (t) => {
  const item = await fixture(t);
  for (const provider of ["Codex", "claude", "unsupported"]) {
    await assert.rejects(cli(item, [...markArgs, "--provider", provider, "--session-id", "valid"]), { code: "ARGUMENT_INVALID" });
  }
  for (const id of ["", " leading", "trailing ", "x/y", "../session", "x".repeat(129), "session:123"]) {
    await assert.rejects(cli(item, [...markArgs, "--provider", "codex", "--session-id", id]), { code: "ARGUMENT_INVALID" });
  }
  for (const flags of [
    ["--provider"], ["--session-id"],
    ["--provider", "codex", "--provider", "claude-code", "--session-id", "id"],
    ["--provider", "codex", "--session-id", "id", "--session-id", "other"],
  ]) await assert.rejects(cli(item, [...markArgs, ...flags]), { code: "ARGUMENT_INVALID" });
  for (const command of ["describe", "configure", "list"]) {
    await assert.rejects(cli(item, [command, "--provider", "codex", "--session-id", "id"]), { code: "ARGUMENT_INVALID" });
  }
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
  const id = `a${"._-1".repeat(31)}xyz`;
  assert.equal(id.length, 128);
  assert.equal((await cli(item, [...markArgs, "--provider", "codex", "--session-id", id])).sessionId, id);
});

test("automatic identity errors stay unchanged when both explicit options are omitted", async (t) => {
  const item = await fixture(t);
  const cases = [
    [{}, "SESSION_ID_UNAVAILABLE"],
    [{ CODEX_THREAD_ID: "alone" }, "SESSION_ID_UNAVAILABLE"],
    [{ CODEX_SESSION_ID: "alone" }, "SESSION_ID_UNAVAILABLE"],
    [{ CODEX_THREAD_ID: "one", CODEX_SESSION_ID: "two" }, "SESSION_ID_MISMATCH"],
    [{ CODEX_THREAD_ID: "same", CODEX_SESSION_ID: "same", CLAUDE_CODE_SESSION_ID: "other" }, "SESSION_PROVIDER_AMBIGUOUS"],
    [{ CLAUDE_CODE_SESSION_ID: "bad/id" }, "SESSION_ID_UNAVAILABLE"],
  ];
  for (const [identity, code] of cases) await assert.rejects(cli(item, markArgs, identity), { code });
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("mark help explains the explicit pair while remaining independent of identity", async (t) => {
  const item = await fixture(t);
  const help = await cli(item, ["mark", "--help"]);
  assert.match(help, /--provider <codex\|claude-code>/);
  assert.match(help, /--session-id <id>/);
  assert.match(help, /Omit both identity options/);
  assert.match(help, /--provider and --session-id together/);
  assert.equal(await cli(item, ["mark", "--provider", "codex", "--help"]), help);
});
