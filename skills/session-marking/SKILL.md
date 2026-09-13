---
name: session-marking
description: Explicitly bind the current Codex or Claude Code session to one operator-selected target with configured local output and optional host projection. Use when the user asks to mark, attach, associate, or record the current session for a task or workflow context.
---

# Session Marking

Mark only the current session. Never accept a provider or session ID from the user, infer a missing
target selection, create shared arm state, or install a prompt-submit hook.

1. Resolve `../../scripts/session-marking.mjs` relative to this file to an absolute CLI path. Run its
   `describe` command to obtain the active resolver's required fields. Continue when the user has
   explicitly selected all required fields.
2. Preserve the user's explicit target fields as the described JSON object and run:

   ```sh
   node '<resolved-cli-path>' mark --selection-json '<json-object>'
   ```

   Use the absolute path from step 1 for `<resolved-cli-path>`. Add `--adapter <name>` only when the
   user explicitly selects an adapter. This asserts the active resolver; configured outputs still
   apply. Keep the user's current working directory.
3. Treat the command's JSON as authoritative. On success, report the provider, session, and target.
   When `local` is present, report its binding status and `bindingPath`; when `projection` is present,
   report the host result. A null `local` means local persistence was disabled and no local binding
   was read or written. On failure, report the bounded error without overwriting or
   repairing a conflicting binding.

The command derives provider and session identity exclusively from the current agent environment.

## Only when needed

| Situation | Read |
| --- | --- |
| Installation is missing or needs updating | [Installation](../../docs/installation.md) |
| The user wants to change destinations or storage, or configuration is invalid | [Configuration](../../docs/configuration.md) |
| Session identity is unavailable, a command fails, or output needs explanation | [CLI reference](../../docs/cli.md) |

These guides support the current request; ordinary marking follows the three steps above.
