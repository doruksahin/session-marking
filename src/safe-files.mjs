import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { fail } from "./errors.mjs";

async function syncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close().catch(() => {}); }
}

export async function secureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 }).catch(() => fail("WRITE_FAILED", "A private directory could not be created."));
  const [stat, canonical] = await Promise.all([lstat(directory).catch(() => null), realpath(directory).catch(() => null)]);
  if (!stat?.isDirectory() || stat.isSymbolicLink() || canonical !== directory) fail("PATH_UNSAFE", "A private directory is not canonical.");
  await chmod(directory, 0o700).catch(() => fail("WRITE_FAILED", "A private directory mode could not be secured."));
  return directory;
}

export async function secureChildDirectory(root, ...parts) {
  await secureDirectory(root);
  let current = root;
  for (const part of parts) {
    if (!part || part === "." || part === ".." || part.includes(path.sep)) fail("PATH_UNSAFE", "A private path component is invalid.");
    current = path.join(current, part);
    await mkdir(current, { mode: 0o700 }).catch((error) => {
      if (error?.code !== "EEXIST") fail("WRITE_FAILED", "A private directory could not be created.");
    });
    const stat = await lstat(current).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) fail("PATH_UNSAFE", "A private directory is unsafe.");
    await chmod(current, 0o700).catch(() => fail("WRITE_FAILED", "A private directory mode could not be secured."));
  }
  return current;
}

export async function readOptionalFile(targetPath, maxBytes) {
  const stat = await lstat(targetPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) fail("FILE_INVALID", "A session-marking file is unsafe or too large.");
  return readFile(targetPath, "utf8").catch(() => fail("FILE_INVALID", "A session-marking file could not be read."));
}

export async function publishExclusive(directory, filename, content, mode) {
  const targetPath = path.join(directory, filename);
  const tempPath = path.join(directory, `.${filename}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0), mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await link(tempPath, targetPath);
    await unlink(tempPath);
    await syncDirectory(directory);
    return true;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    if (error?.code === "EEXIST") return false;
    fail("WRITE_FAILED", "A session binding could not be published durably.");
  }
}

export async function replacePrivateFile(directory, filename, content) {
  await secureDirectory(directory);
  const targetPath = path.join(directory, filename);
  const tempPath = path.join(directory, `.${filename}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0), 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, targetPath);
    await chmod(targetPath, 0o600);
    await syncDirectory(directory);
  } catch {
    if (handle) await handle.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    fail("WRITE_FAILED", "Session-marking configuration could not be written.");
  }
  return targetPath;
}
