import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runCli } from "../scripts/session-marking.mjs";
import { createBinding, renderBinding } from "../src/binding.mjs";
import { claimBinding } from "../src/store.mjs";
import { sessionUrl } from "../src/session.mjs";

const execute = promisify(execFile);
const cliPath = fileURLToPath(new URL("../scripts/session-marking.mjs", import.meta.url));

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "list-session-marking-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    environment: {
      HOME: root,
      SESSION_MARKING_CONFIG_DIR: path.join(root, "config"),
      SESSION_MARKING_STATE_DIR: path.join(root, "state"),
    },
  };
}

function list(item, ...args) {
  return runCli({ argv: ["list", ...args], environment: item.environment, cwd: item.root });
}

async function save(item, id, target, { provider = "codex", markedAt = "2026-09-13T10:00:00.000Z" } = {}) {
  const binding = createBinding({
    schemaVersion: 2,
    session: { id, provider, url: sessionUrl(provider, id) },
    target,
    markedAt,
    workingDirectory: item.root,
  });
  const result = await claimBinding(binding, { environment: item.environment });
  return { binding, file: result.targetPath };
}

async function configure(item, config) {
  await mkdir(item.environment.SESSION_MARKING_CONFIG_DIR, { recursive: true });
  await writeFile(path.join(item.environment.SESSION_MARKING_CONFIG_DIR, "config.json"), JSON.stringify(config));
}

async function snapshot(directory) {
  const stat = await lstat(directory);
  const result = { mode: stat.mode, mtime: stat.mtimeMs };
  if (stat.isDirectory()) {
    result.entries = {};
    for (const name of (await readdir(directory)).sort()) result.entries[name] = await snapshot(path.join(directory, name));
  } else if (stat.isFile()) result.content = await readFile(directory, "utf8");
  return result;
}

test("list returns full saved bindings newest first without current-session identity", async (t) => {
  const item = await fixture(t);
  const first = await save(item, "first", { jiraKey: "ATT-5551", stageId: "implementation" });
  const last = await save(item, "last", { project: "website", task: "fix-login" }, { provider: "claude-code", markedAt: "2026-09-13T12:00:00.000Z" });
  assert.deepEqual(await list(item), { ok: true, sessions: [last.binding, first.binding] });
  assert.deepEqual((await list(item, "--order", "asc")).sessions, [first.binding, last.binding]);
  const { stdout, stderr } = await execute(process.execPath, [cliPath, "list"], { env: item.environment, cwd: item.root });
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { ok: true, sessions: [last.binding, first.binding] });
  assert.equal(stdout.trim().split("\n").length, 1);
});

test("list includes sessions created through the unchanged mark command", async (t) => {
  const item = await fixture(t);
  const marked = await runCli({
    argv: ["mark", "--selection-json", '{"project":"website","task":"fix-login"}'],
    environment: { ...item.environment, CODEX_THREAD_ID: "cli-session", CODEX_SESSION_ID: "cli-session" },
    cwd: item.root,
  });
  const saved = JSON.parse(await readFile(marked.bindingPath, "utf8"));
  assert.deepEqual(await list(item, "--filter", "target.project=website"), { ok: true, sessions: [saved] });
});

test("repeated exact filters combine and explicit stage sorting is alphabetical with stable identity ties", async (t) => {
  const item = await fixture(t);
  const planning = await save(item, "planning", { jiraKey: "ATT-5551", stageId: "planning" });
  const implementation = await save(item, "implementation", { jiraKey: "ATT-5551", stageId: "implementation" });
  const claude = await save(item, "claude", { jiraKey: "ATT-5551", stageId: "implementation" }, { provider: "claude-code" });
  const other = await save(item, "other", { jiraKey: "ATT-5552", stageId: "implementation" });
  const missing = await save(item, "missing", { jiraKey: "ATT-5551" });
  const args = ["--filter", "target.jiraKey=ATT-5551", "--sort", "target.stageId"];
  assert.deepEqual((await list(item, ...args)).sessions, [claude.binding, implementation.binding, planning.binding, missing.binding]);
  assert.deepEqual((await list(item, ...args, "--order", "desc")).sessions, [planning.binding, claude.binding, implementation.binding, missing.binding]);
  assert.deepEqual((await list(item, ...args, "--filter", "session.provider=codex", "--filter", "target.stageId=implementation")).sessions, [implementation.binding]);
  assert.deepEqual((await list(item, "--filter", "target.jiraKey=ATT-5552")).sessions, [other.binding]);
  assert.deepEqual(await list(item, "--filter", "target.jiraKey=att-5551"), { ok: true, sessions: [] });
});

test("filters compare scalar text, preserve equals and empty values, and only traverse own object properties", async (t) => {
  const item = await fixture(t);
  const target = JSON.parse('{"label":"x=y","empty":"","count":10,"enabled":true,"optional":null,"nested":{"name":"inside"},"array":["inside"],"__proto__":{"name":"own"}}');
  const saved = await save(item, "scalars", target);
  for (const filter of ["target.label=x=y", "target.empty=", "target.count=10", "target.enabled=true", "target.optional=null", "target.nested.name=inside", "target.__proto__.name=own", "schemaVersion=2"]) {
    assert.deepEqual((await list(item, "--filter", filter)).sessions, [saved.binding], filter);
  }
  for (const filter of ["target.count=010", "target.missing=null", "target.nested=[object Object]", "target.array=inside", "target.array.length=1", "target.constructor.name=Object", "session.__proto__.constructor.name=Object"]) {
    assert.deepEqual((await list(item, "--filter", filter)).sessions, [], filter);
  }
});

test("scalar sorting is lexical, non-scalars stay last, and equal values use provider/id ascending", async (t) => {
  const item = await fixture(t);
  const two = await save(item, "two", { rank: 2 });
  const ten = await save(item, "ten", { rank: 10 });
  const object = await save(item, "z-object", { rank: {} });
  const array = await save(item, "a-array", { rank: [] });
  assert.deepEqual((await list(item, "--sort", "target.rank")).sessions, [ten.binding, two.binding, array.binding, object.binding]);
  assert.deepEqual((await list(item, "--sort", "target.rank", "--order", "desc")).sessions, [two.binding, ten.binding, array.binding, object.binding]);
  assert.deepEqual((await list(item)).sessions.map((record) => record.session.id), ["a-array", "ten", "two", "z-object"]);
});

test("a missing store returns empty without initializing config or creating directories", async (t) => {
  const item = await fixture(t);
  const before = await snapshot(item.root);
  assert.deepEqual(await list(item), { ok: true, sessions: [] });
  assert.deepEqual(await snapshot(item.root), before);
});

test("listing reads saved records with local disabled without checking or importing the host", async (t) => {
  const item = await fixture(t);
  const saved = await save(item, "saved", { jiraKey: "ATT-5551", stageId: "implementation" });
  const unavailable = path.join(item.root, "missing-adapter.mjs");
  const throwing = path.join(item.root, "throwing-adapter.mjs");
  await writeFile(throwing, "throw new Error('listing must never import this');");
  for (const module of [unavailable, throwing]) {
    await configure(item, { schemaVersion: 3, local: { enabled: false }, host: { enabled: true, name: "fixture", module } });
    const before = await snapshot(item.root);
    assert.deepEqual(await list(item), { ok: true, sessions: [saved.binding] });
    assert.deepEqual(await snapshot(item.root), before);
  }
  await configure(item, { schemaVersion: 3, local: { enabled: false }, host: { enabled: false } });
  assert.deepEqual((await list(item)).sessions, [saved.binding]);
});

test("listing honors configured local directory and gives the environment override precedence", async (t) => {
  const item = await fixture(t);
  const overridden = await save(item, "override", { project: "override" });
  const customDirectory = path.join(item.root, "custom-store");
  const custom = await save({ ...item, environment: { ...item.environment, SESSION_MARKING_STATE_DIR: customDirectory } }, "custom", { project: "custom" });
  await configure(item, { schemaVersion: 3, local: { directory: customDirectory } });
  assert.deepEqual((await list(item)).sessions, [overridden.binding]);
  delete item.environment.SESSION_MARKING_STATE_DIR;
  assert.deepEqual((await list(item)).sessions, [custom.binding]);
});

test("listing never changes existing modes, contents, or modification times and ignores unpublished temporary files", async (t) => {
  const item = await fixture(t);
  const saved = await save(item, "saved", { project: "website" });
  await chmod(item.environment.SESSION_MARKING_STATE_DIR, 0o755);
  await chmod(saved.file, 0o644);
  await writeFile(path.join(path.dirname(saved.file), ".saved.json.unfinished.tmp"), "incomplete");
  await mkdir(path.join(path.dirname(saved.file), "unrelated"));
  await writeFile(path.join(path.dirname(saved.file), "unrelated", "invalid.json"), "not scanned recursively");
  const before = await snapshot(item.root);
  assert.deepEqual((await list(item)).sessions, [saved.binding]);
  assert.deepEqual(await snapshot(item.root), before);
});

test("invalid list arguments fail before configuration or filesystem access and old commands keep rejecting duplicates", async (t) => {
  const item = await fixture(t);
  await configure(item, { invalid: "configuration" });
  const invalid = [
    ["--sort"], ["--sort", "target.stageId", "--sort", "markedAt"], ["--order", "up"],
    ["--order", "asc", "--order", "desc"], ["--unknown", "value"], ["--filter", "target.project"],
    ["--filter", "=website"], ["--filter", "target.project!=website"], ["--sort", "target..project"],
    ["--sort", "target.array.0"], ["--sort", "constructor.name"], ["--adapter", "local"],
    ["--filter", "target.project=website", "extra"], ["--filter", "--sort"],
  ];
  for (const args of invalid) await assert.rejects(list(item, ...args), { code: "ARGUMENT_INVALID" }, args.join(" "));
  for (const command of ["mark", "describe", "configure"]) {
    await assert.rejects(runCli({ argv: [command, "--adapter", "local", "--adapter", "local"], environment: item.environment }), { code: "ARGUMENT_INVALID" });
  }
});

test("corrupt, noncanonical, oversized, and misplaced binding files fail without partial output or writes", async (t) => {
  for (const kind of ["empty", "json", "noncanonical", "oversized", "id", "provider", "filename", "symlink", "directory"]) {
    await t.test(kind, async (t) => {
      const item = await fixture(t);
      const saved = await save(item, "good", { project: "website" });
      const bad = path.join(path.dirname(saved.file), kind === "filename" ? "bad name.json" : "bad.json");
      if (kind === "symlink") await symlink(saved.file, bad);
      else if (kind === "directory") await mkdir(bad);
      else {
        let content = "";
        if (kind === "json") content = "{";
        if (kind === "noncanonical") content = JSON.stringify({ ...saved.binding, session: { ...saved.binding.session, id: "bad", url: sessionUrl("codex", "bad") } });
        if (kind === "oversized") content = "x".repeat(64 * 1024 + 1);
        if (["id", "filename"].includes(kind)) content = renderBinding(saved.binding);
        if (kind === "provider") content = renderBinding(createBinding({ ...saved.binding, session: { provider: "claude-code", id: "bad", url: null } }));
        await writeFile(bad, content);
      }
      const before = await snapshot(item.root);
      const code = ["oversized", "symlink", "directory"].includes(kind) ? "FILE_INVALID" : "BINDING_INVALID";
      await assert.rejects(list(item, "--filter", "target.project=absent"), { code });
      await assert.rejects(execute(process.execPath, [cliPath, "list"], { env: item.environment }), (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, "");
        assert.equal(JSON.parse(error.stderr).code, code);
        return true;
      });
      assert.deepEqual(await snapshot(item.root), before);
    });
  }
});

test("listing rejects symlinked or non-directory store paths without following them", async (t) => {
  for (const location of ["state", "bindings", "codex"]) {
    for (const kind of ["symlink", "file"]) {
      await t.test(`${location} ${kind}`, async (t) => {
        const item = await fixture(t);
        const parts = [item.environment.SESSION_MARKING_STATE_DIR, "bindings", "codex"];
        const index = ["state", "bindings", "codex"].indexOf(location);
        const unsafe = path.join(...parts.slice(0, index + 1));
        await mkdir(path.dirname(unsafe), { recursive: true });
        if (kind === "symlink") {
          const outside = path.join(item.root, "outside");
          await mkdir(outside);
          await symlink(outside, unsafe);
        } else await writeFile(unsafe, "preserve me");
        const before = await snapshot(item.root);
        await assert.rejects(list(item), { code: "PATH_UNSAFE" });
        assert.deepEqual(await snapshot(item.root), before);
      });
    }
  }
});
