import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runCli } from "../scripts/session-marking.mjs";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../scripts/session-marking.mjs", import.meta.url));
const commands = ["configure", "describe", "mark", "list"];

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "session-marking-help-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environment = {
    HOME: root,
    SESSION_MARKING_CONFIG_DIR: path.join(root, "config"),
    SESSION_MARKING_STATE_DIR: path.join(root, "state"),
  };
  const invoke = (argv) => execute(process.execPath, [cli, ...argv], { env: environment, cwd: root });
  return { root, environment, invoke };
}

test("top-level help and command help are text on stdout and bypass invalid user configuration", async (t) => {
  const item = await fixture(t);
  await mkdir(item.environment.SESSION_MARKING_CONFIG_DIR);
  const configPath = path.join(item.environment.SESSION_MARKING_CONFIG_DIR, "config.json");
  await writeFile(configPath, "invalid JSON: help must not read this");
  const before = await stat(configPath);
  for (const argv of [[], ["--help"], ["-h"], ...commands.flatMap((name) => [[name, "--help"], [name, "-h"]])]) {
    const { stdout, stderr } = await item.invoke(argv);
    assert.equal(stderr, "");
    assert.match(stdout, /Usage: session-marking /);
    assert.doesNotMatch(stdout, /^\s*\{/);
    if (commands.includes(argv[0])) assert(stdout.includes(`session-marking ${argv[0]}`));
    else for (const name of commands) assert.match(stdout, new RegExp(`\\b${name}\\b`));
  }
  assert.equal(await readFile(configPath, "utf8"), "invalid JSON: help must not read this");
  assert.equal((await stat(configPath)).mtimeMs, before.mtimeMs);
  assert.deepEqual((await readdir(item.root)).sort(), ["config"]);
});

test("help needs neither usable paths nor session identity and does not import the configured host", async (t) => {
  const item = await fixture(t);
  const module = path.join(item.root, "host.mjs");
  const sentinel = path.join(item.root, "host-loaded");
  await writeFile(module, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'loaded'); throw new Error('unexpected import');`);
  await mkdir(item.environment.SESSION_MARKING_CONFIG_DIR);
  await writeFile(path.join(item.environment.SESSION_MARKING_CONFIG_DIR, "config.json"), JSON.stringify({ schemaVersion: 3, host: { enabled: true, name: "fixture", module } }));
  for (const name of commands) {
    await item.invoke([name, "--help"]);
    const help = await runCli({ argv: [name, "--help"], environment: { SESSION_MARKING_CONFIG_DIR: "/", CODEX_THREAD_ID: "mismatch", CODEX_SESSION_ID: "other", CLAUDE_CODE_SESSION_ID: "ambiguous" } });
    assert.equal(typeof help, "string");
  }
  await assert.rejects(stat(sentinel), { code: "ENOENT" });
  await assert.rejects(stat(item.environment.SESSION_MARKING_STATE_DIR), { code: "ENOENT" });
});

test("unknown commands and malformed options retain JSON errors, including with help", async (t) => {
  const item = await fixture(t);
  for (const argv of [
    ["unknown", "--help"], ["--help", "unknown"], ["list", "--help", "--unknown"],
    ["mark", "--selection-json", "--help"], ["list", "--help", "--sort"],
    ["describe", "--help", "-h"], ["mark"],
  ]) {
    await assert.rejects(item.invoke(argv), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      const result = JSON.parse(error.stderr);
      assert.equal(result.ok, false);
      assert.equal(result.code, "ARGUMENT_INVALID");
      return true;
    }, argv.join(" "));
  }
  assert.deepEqual(await readdir(item.root), []);
});

test("every displayed command example runs through the executable and normal commands still emit JSON", async (t) => {
  const item = await fixture(t);
  const bin = path.join(item.root, "bin");
  await mkdir(bin);
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(path.join(bin, "session-marking"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`, { mode: 0o700 });
  const environment = { ...item.environment, PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`, CODEX_THREAD_ID: "help-example", CODEX_SESSION_ID: "help-example" };
  for (const command of commands) {
    const { stdout: help } = await item.invoke([command, "--help"]);
    const examples = help.split("\n").filter((line) => /^\s+session-marking /.test(line)).map((line) => line.trim());
    assert(examples.length > 0, `${command} should have a runnable example`);
    for (const example of examples) {
      const { stdout, stderr } = await execute("/bin/sh", ["-c", example], { env: environment, cwd: item.root });
      assert.equal(stderr, "");
      assert.equal(JSON.parse(stdout).ok, true, example);
    }
  }
  const { stdout } = await item.invoke(["list"]);
  assert.equal(JSON.parse(stdout).sessions.length, 1);
});
