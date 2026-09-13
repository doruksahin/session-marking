# Adapter API version 1

The portable plugin uses built-in local mode unless an external adapter is configured. An external
adapter owns target selection, validation, and projection into its host. The plugin owns provider
identity, local target selection, and the immutable machine-local session claim in either mode. See [the loader](../src/adapter.mjs) and
[the operation order](../src/mark.mjs) for executable authority.

## Local mode and configuration

Missing configuration selects built-in local mode without writing a configuration file. Local
selection is exactly `{ "project": "website", "task": "fix-login" }`: each value must be a nonblank
string of 1–256 characters with no leading or trailing whitespace. The resulting target is `{ "kind": "local/project-task-v1", "project": "website", "task": "fix-login" }`
and is stored in the existing immutable binding. The kind namespaces local target identity. Local mode does not load an external module or create a second
local record; successful `mark` returns `projection: null`.

`configure --adapter local` explicitly saves `{ "schemaVersion": 2, "mode": "local" }`.
Existing version-1 external configuration remains supported and active, including an external
adapter named `local`. Supplying `--module` always registers an external adapter. Malformed or unsupported
configuration fails instead of falling back to local mode. Configuration changes affect future
commands and do not rewrite existing bindings. Optional `--adapter` asserts the selected mode or
adapter name; it does not route a command to another destination.

Both modes return the absolute canonical `bindingPath` on successful marking. Configuration and
state keep the existing platform defaults in [paths.mjs](../src/paths.mjs).
`SESSION_MARKING_CONFIG_DIR` and `SESSION_MARKING_STATE_DIR` override those directories independently
with absolute paths; callers must keep their environment consistent across invocations.

## Register and invoke

Register the adapter through the public CLI; use an absolute path to its module:

```sh
node /absolute/path/to/session-marking/scripts/session-marking.mjs configure \
  --adapter example --module /absolute/path/to/adapter.mjs
node /absolute/path/to/session-marking/scripts/session-marking.mjs describe
node /absolute/path/to/session-marking/scripts/session-marking.mjs mark \
  --selection-json '{"work":"example"}'
```

`describe` and `mark` accept an optional `--adapter` that must match the configured adapter.
Hosts invoke this CLI instead of importing portable implementation files. The provider supplies
session identity through its environment; command arguments cannot override that identity.
[The CLI](../scripts/session-marking.mjs) emits one JSON success object to stdout, or a JSON error
object to stderr with exit status 1. `configure` registers the path without loading the adapter;
`describe` and `mark` validate its exports when loading it.

## Exports

| Export | Input | Result |
| --- | --- | --- |
| `adapterApiVersion` | — | Numeric constant `1` |
| `describeSelection()` | No arguments | Canonicalizable JSON object describing host selection |
| `resolveTarget({ selection, workingDirectory })` | Canonical JSON selection and canonical absolute working directory | Exactly `{ target, context }`; `target` is a canonicalizable JSON object, `context` is a plain object |
| `projectBinding({ binding, context })` | The durable winning claim and context returned by this invocation's resolution | Canonicalizable JSON object describing projection |

Functions may be synchronous or asynchronous. The outer input objects are frozen. JSON
normalization rules live in [canonical-json.mjs](../src/canonical-json.mjs). Context is transient:
it is passed to projection, is not stored in the binding, and need not be serializable.

## Target and retry obligations

`target` is the durable target identity. Resolution must produce the same target for equivalent
selections across retries. Use stable host identifiers; transient selection context belongs in
`context`. The adapter validates the current host selection before the plugin attempts a claim.

The plugin persists the claim before calling projection. A conflicting target fails with
`BINDING_CONFLICT` and never reaches projection. An identical retry reuses the existing claim,
including its original timestamp and working directory, then calls projection again with fresh
resolution context. Therefore projection must be safe to repeat and repair partial host writes.
A projection failure leaves the durable claim in place; retrying the same target can repair it.
See [binding matching](../src/binding.mjs) and [claim storage](../src/store.mjs).

Binding schema version 2 contains `schemaVersion`, `session` (`provider`, `id`, `url`), `target`,
`markedAt`, and `workingDirectory`. Providers are `codex` and `claude-code`; Claude Code's URL is
`null`. Treat the binding as immutable. Projection output is returned to the caller, not stored
in the binding. The [binding implementation](../src/binding.mjs) owns exact validation rules.

## Errors

An adapter can expose an operator-actionable error by throwing an error with
`name: "SessionMarkAdapterError"`, a code matching `^[A-Z][A-Z0-9_]{0,63}$`, and a nonempty message
of at most 512 characters. Those fields become the CLI error code and message. Keep messages
safe for display. Other thrown errors are masked as `SESSION_MARK_FAILED` at the CLI boundary.
Missing exports or the wrong API version fail with `ADAPTER_INVALID`; import failures use
`ADAPTER_LOAD_FAILED`.

## Compatibility

External adapters retain API version 1 and configuration schema version 1. Explicit local mode
uses configuration schema version 2; both modes retain binding schema version 2 and all
[machine-local paths](../src/paths.mjs). Source checkout and marketplace changes do not
change existing claims or require a state reset. External configuration stores the canonical adapter path;
register it again when the adapter moves. Each command selects local mode or one configured external adapter. The plugin has no
multi-adapter broadcasting, host-specific routing, or SDK dependency.
