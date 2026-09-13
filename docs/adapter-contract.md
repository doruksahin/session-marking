# Adapter API version 1

The portable plugin loads one configured local ES module. The adapter owns target selection,
validation, and projection into its host. The plugin owns provider identity and the immutable
machine-local session claim. See [the loader](../src/adapter.mjs) and
[the operation order](../src/mark.mjs) for executable authority.

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

This extraction preserves API version 1, configuration schema version 1, binding schema version 2,
and all [machine-local paths](../src/paths.mjs). Source checkout and marketplace changes do not
change existing claims or require a state reset. Configuration stores the canonical adapter path;
register it again when the adapter moves. The portable plugin has one configured adapter and no
host-specific routing or SDK dependency.
