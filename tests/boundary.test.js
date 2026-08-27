import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(target));
    else if (entry.isFile()) result.push(target);
  }
  return result;
}

test("portable implementation contains no adc-vault layout or domain dependency", async () => {
  const roots = ["src", "scripts", "skills"].map((name) => path.join(pluginRoot, name));
  const files = (await Promise.all(roots.map(filesBelow))).flat();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /adc-vault|10 Tasks\/Packets|JIRA_KEY_PATTERN|validatePacketStage|session-record\.mjs/, path.relative(pluginRoot, file));
  }
});
