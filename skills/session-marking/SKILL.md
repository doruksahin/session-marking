---
name: session-marking
description: Bind a Codex or Claude Code session to one operator-selected target with configured local output and optional host projection. Use when the user asks to mark, attach, associate, or record a session for a task or workflow context.
---

# Session Marking

Use the current provider environment by default. When the user selects a known session explicitly,
obtain both its provider and session ID; preserve the operator's choice. Ask for missing target
fields rather than inferring them.

1. Resolve `../../scripts/session-marking.mjs` relative to this file to an absolute CLI path. Run its
   `describe` command to obtain the common fields and any enabled host requirements. Continue when
   the user has explicitly selected all required fields.
2. Preserve the user's explicit target fields as the described JSON object and run:

   ```sh
   node '<resolved-cli-path>' mark --selection-json '<json-object>'
   ```

   Use the absolute path from step 1 for `<resolved-cli-path>`. Add `--adapter <name>` only when the
   user explicitly selects an adapter. This asserts the configured adapter; configured outputs still
   apply. Pass a user-supplied work description separately with `--description`; it is not a target
   field. For an explicitly selected session, add both `--provider` and `--session-id` using the
   [identity rules](../../docs/cli.md#session-identity). Keep the user's current working directory.
3. Treat the command's JSON as authoritative. On success, report the provider, session, and target.
   When `local` is present, report its binding status and `bindingPath`; when `projection` is present,
   report the host result. A null `local` means local persistence was disabled and no local binding
   was read or written. On failure, report the bounded error without overwriting or
   repairing a conflicting binding.

## Only when needed

| Situation | Read |
| --- | --- |
| Installation is missing or needs updating | [Installation](../../docs/installation.md) |
| The user wants to change destinations or storage, or configuration is invalid | [Configuration](../../docs/configuration.md) |
| Session identity is unavailable, a command fails, or output needs explanation | [CLI reference](../../docs/cli.md) |

These guides support the current request; ordinary marking follows the three steps above.
