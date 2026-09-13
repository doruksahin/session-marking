import path from "node:path";

import { fail } from "./errors.mjs";

function absoluteDirectory(value, label, code = "PATH_INVALID") {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) fail(code, `${label} is not absolute.`);
  const normalized = path.normalize(value);
  if (normalized === path.parse(normalized).root) fail(code, `${label} is too broad.`);
  return normalized;
}

export function configuredLocalDirectory(value) {
  return value === null ? null : absoluteDirectory(value, "The local directory", "CONFIG_INVALID");
}

function homeDirectory(environment) {
  return absoluteDirectory(environment.HOME || environment.USERPROFILE || "", "The user home directory");
}

export function configDirectory(environment = process.env, platform = process.platform) {
  if (environment.SESSION_MARKING_CONFIG_DIR) return absoluteDirectory(environment.SESSION_MARKING_CONFIG_DIR, "The configuration directory");
  const home = homeDirectory(environment);
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "session-marking");
  if (platform === "win32") return path.join(absoluteDirectory(environment.APPDATA || path.join(home, "AppData", "Roaming"), "The application-data directory"), "session-marking");
  return path.join(environment.XDG_CONFIG_HOME ? absoluteDirectory(environment.XDG_CONFIG_HOME, "The XDG configuration directory") : path.join(home, ".config"), "session-marking");
}

export function stateDirectory(environment = process.env, platform = process.platform, directory = null) {
  if (environment.SESSION_MARKING_STATE_DIR) return absoluteDirectory(environment.SESSION_MARKING_STATE_DIR, "The state directory");
  if (directory !== null) return configuredLocalDirectory(directory);
  const home = homeDirectory(environment);
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "session-marking", "state");
  if (platform === "win32") return path.join(absoluteDirectory(environment.LOCALAPPDATA || path.join(home, "AppData", "Local"), "The local application-data directory"), "session-marking", "state");
  return path.join(environment.XDG_STATE_HOME ? absoluteDirectory(environment.XDG_STATE_HOME, "The XDG state directory") : path.join(home, ".local", "state"), "session-marking");
}

export function canonicalWorkingDirectory(value) {
  return absoluteDirectory(value, "The current working directory");
}
