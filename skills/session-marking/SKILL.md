---
name: session-marking
description: Explicitly bind the current Codex or Claude Code session to one operator-selected target locally or through the configured host adapter. Use when the user asks to mark, attach, associate, or record the current session for a task or workflow context.
---

# Session Marking

Mark only the current session. Never accept a provider or session ID from the user, infer a missing
target selection, create shared arm state, or install a prompt-submit hook.

1. Resolve `../../scripts/session-marking.mjs` relative to this file. Run its `describe` command to
   obtain the selected mode's required fields (`project` and `task` in default local mode). Do not infer any required field the
   user did not select.
2. Preserve the user's explicit target fields as the described JSON object and run:

   ```sh
   node ../../scripts/session-marking.mjs mark --selection-json '<json-object>'
   ```

   Add `--adapter <name>` only when the user explicitly selects an adapter. Keep the user's current
   working directory.
3. Treat the command's JSON as authoritative. On success, report the provider, session, immutable
   target, binding status, and saved `bindingPath`; report a host projection when present (`null` in local mode). On failure, report the bounded error without
   overwriting or repairing a conflicting binding.

The command derives provider and session identity exclusively from the current agent environment.
