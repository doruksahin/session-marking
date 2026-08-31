import { fail } from "./errors.mjs";

export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const PROVIDERS = Object.freeze(["codex", "claude-code"]);

export function validateProvider(provider, code = "PROVIDER_INVALID") {
  if (!PROVIDERS.includes(provider)) fail(code, "The session provider is unsupported.");
  return provider;
}

export function sessionUrl(provider, sessionId) {
  validateProvider(provider);
  if (!SESSION_ID_PATTERN.test(sessionId || "")) fail("SESSION_ID_UNAVAILABLE", "The current-session identity is not canonical.");
  return provider === "codex" ? `codex://threads/${sessionId}` : null;
}

export function currentSession(environment) {
  const threadId = environment.CODEX_THREAD_ID;
  const codexId = environment.CODEX_SESSION_ID;
  const claudeId = environment.CLAUDE_CODE_SESSION_ID;
  const hasCodex = threadId !== undefined || codexId !== undefined;
  const hasClaude = claudeId !== undefined;
  if (hasCodex && hasClaude) fail("SESSION_PROVIDER_AMBIGUOUS", "More than one supported provider identity is present.");
  if (hasCodex) {
    if (!SESSION_ID_PATTERN.test(threadId || "") || !SESSION_ID_PATTERN.test(codexId || "")) {
      fail("SESSION_ID_UNAVAILABLE", "Codex did not provide a canonical current-session identity.");
    }
    if (threadId !== codexId) fail("SESSION_ID_MISMATCH", "Codex current-session identifiers do not match.");
    return Object.freeze({ provider: "codex", id: codexId, url: sessionUrl("codex", codexId) });
  }
  if (hasClaude) {
    if (!SESSION_ID_PATTERN.test(claudeId || "")) {
      fail("SESSION_ID_UNAVAILABLE", "Claude Code did not provide a canonical current-session identity.");
    }
    return Object.freeze({ provider: "claude-code", id: claudeId, url: null });
  }
  fail("SESSION_ID_UNAVAILABLE", "No supported provider supplied a canonical current-session identity.");
}
