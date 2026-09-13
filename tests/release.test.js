import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { syncVersionMirrors, verifyVersionMirrors } from "../scripts/sync-version.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture(t, { malformedMarketplace = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "session-marking-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = path.join(root, "plugins", "session-marking");
  await mkdir(path.join(plugin, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(plugin, ".claude-plugin"), { recursive: true });
  await mkdir(path.join(root, ".claude-plugin"), { recursive: true });
  await writeFile(path.join(plugin, "package.json"), '{"name":"session-marking","version":"2.3.4"}\n');
  await writeFile(path.join(plugin, ".codex-plugin", "plugin.json"), '{"name":"session-marking","version":"1.0.0","description":"test"}\n');
  await writeFile(path.join(plugin, ".claude-plugin", "plugin.json"), '{"name":"session-marking","version":"1.0.0","description":"test"}\n');
  const plugins = malformedMarketplace
    ? [{ name: "session-marking", version: "1.0.0" }, { name: "session-marking", version: "1.0.0" }]
    : [{ name: "session-marking", version: "1.0.0" }, { name: "other", version: "9.0.0" }];
  await writeFile(path.join(root, ".claude-plugin", "marketplace.json"), `${JSON.stringify({ name: "host-marketplace", plugins })}\n`);
  return { root, plugin };
}

test("version synchronization updates exactly three mirrors and is idempotent", async (t) => {
  const item = await fixture(t);
  const options = { pluginRoot: item.plugin, marketplacePaths: [path.join(item.root, ".claude-plugin", "marketplace.json")] };
  assert.throws(() => verifyVersionMirrors(options), /version mismatch/);
  const first = syncVersionMirrors(options);
  assert.equal(first.version, "2.3.4");
  assert.equal(first.updated.length, 3);
  assert.deepEqual(verifyVersionMirrors(options), { version: "2.3.4", files: 3 });
  const second = syncVersionMirrors(options);
  assert.equal(second.updated.length, 0);
  const marketplace = JSON.parse(await readFile(path.join(item.root, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(marketplace.plugins.find((plugin) => plugin.name === "session-marking").version, "2.3.4");
  assert.equal(marketplace.plugins.find((plugin) => plugin.name === "other").version, "9.0.0");
});

test("invalid release metadata fails before any mirror is changed", async (t) => {
  const item = await fixture(t, { malformedMarketplace: true });
  const codexPath = path.join(item.plugin, ".codex-plugin", "plugin.json");
  const before = await readFile(codexPath, "utf8");
  assert.throws(() => syncVersionMirrors({ pluginRoot: item.plugin, marketplacePaths: [path.join(item.root, ".claude-plugin", "marketplace.json")] }), /marketplace entry/);
  assert.equal(await readFile(codexPath, "utf8"), before);
});

test("native marketplaces resolve to this plugin root and the release lane owns its version mirrors", async () => {
  const readJson = async (name) => JSON.parse(await readFile(path.join(pluginRoot, name), "utf8"));
  const metadata = await readJson("package.json");
  const codex = await readJson(".agents/plugins/marketplace.json");
  const claude = await readJson(".claude-plugin/marketplace.json");
  for (const marketplace of [codex, claude]) {
    assert.equal(marketplace.name, metadata.name);
    assert.equal(marketplace.plugins.length, 1);
    assert.equal(marketplace.plugins[0].name, metadata.name);
  }
  assert.equal(codex.plugins[0].source.source, "local");
  assert.equal(path.resolve(pluginRoot, codex.plugins[0].source.path), pluginRoot);
  assert.equal(path.resolve(pluginRoot, claude.plugins[0].source), pluginRoot);
  assert.deepEqual(verifyVersionMirrors({ marketplacePaths: [path.join(pluginRoot, ".claude-plugin/marketplace.json")] }), { version: metadata.version, files: 3 });
  const release = await readJson("release-please-config.json");
  assert.deepEqual(Object.keys(release.packages), ["."]);
  assert.equal(release.packages["."].component, metadata.name);
  assert.equal(release.packages["."]["release-type"], "node");
  assert.equal(release.packages["."]["include-component-in-tag"], true);
  assert.deepEqual(release.packages["."]["extra-files"], [
    { type: "json", path: ".codex-plugin/plugin.json", jsonpath: "$.version" },
    { type: "json", path: ".claude-plugin/plugin.json", jsonpath: "$.version" },
    { type: "json", path: ".claude-plugin/marketplace.json", jsonpath: "$.plugins[0].version" },
  ]);
  assert.deepEqual(await readJson(".release-please-manifest.json"), { ".": metadata.version });
});
