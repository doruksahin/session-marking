# Adapter API version 2

[Start here](../README.md) · Operator setup: [configuration](configuration.md) · Commands: [CLI guide](cli.md)

The portable plugin owns the common target fields, provider identity, and optional immutable local
binding. An enabled host validates that target for its destination and projects the binding there.
It does not replace the core target. See [the loader](../src/adapter.mjs) and
[the operation order](../src/mark.mjs) for executable authority.

## Local mode and configuration

See [configuration](configuration.md) for defaults, destination switches, and storage paths.
Local storage accepts the common target without a host. When a host is enabled, both destinations
receive the same binding. Disabled hosts are never imported.

## Register and invoke

Hosts invoke the [public CLI](cli.md#configure) instead of importing portable implementation files.
Register through `configure --adapter <name> --module <absolute-path>`, then use `describe` and
`mark` as documented in the [CLI guide](cli.md). Registration validates the path without loading
the adapter; `describe` and `mark` validate its exports when loading it.

Optional `--adapter` asserts the configured adapter and never changes enabled destinations.
The core obtains session identity from the provider environment or an explicit CLI pair; see
[session identity](cli.md#session-identity). The CLI's success and failure envelopes are documented
in the [command reference](cli.md).

## Exports

| Export | Input | Result |
| --- | --- | --- |
| `adapterApiVersion` | — | Numeric constant `2` |
| `describeRequirements()` | No arguments | `{ required, description }`; `required` is `[]` or `["stageId"]`, and `description` explains the host's constraints |
| `prepareBinding({ target, workingDirectory })` | Validated core target and canonical absolute working directory | Exactly `{ context }`; `context` is a plain object |
| `projectBinding({ binding, context, bindingPersisted })` | The binding, prepared context, and whether the plugin persisted the binding locally | Canonicalizable JSON object describing projection |

The core validates `project`, `task`, and optional `stageId` as described under [mark](cli.md#mark),
then adds `kind: "session-marking/target-v1"`. `describeRequirements` lets a host require the stage
and explain destination constraints. The core includes those requirements in `describe` output and
checks required fields during marking. `prepareBinding` validates the target against the host and
returns only transient context for publication. Host-specific identifiers and paths belong in that
context or the host record; the adapter cannot replace the target saved locally.

`bindingPersisted` is sent as `false` for host-only execution. Local-enabled calls receive
`{ binding, context }`; an omitted flag means `true`. When false, `binding` is this invocation's
candidate, including its current timestamp and working directory. The host owns persistence,
conflict detection, and preserving its first observation on retries.

Functions may be synchronous or asynchronous. The outer input objects are frozen. JSON
normalization rules live in [canonical-json.mjs](../src/canonical-json.mjs). Context is transient:
it is passed to projection, is not stored in the binding, and need not be serializable.

## Target and retry obligations

The adapter validates the target before the plugin attempts a local claim. With local persistence
enabled, the plugin persists the claim before calling projection. A conflicting target fails with
`BINDING_CONFLICT` and never reaches projection. An identical retry reuses the existing claim,
including its original timestamp and working directory, then calls projection with fresh context.
Projection must therefore be safe to repeat and repair partial host writes. A projection failure
leaves the durable claim in place; retrying the same target can repair it.
See [binding matching](../src/binding.mjs) and [claim storage](../src/store.mjs).

With local persistence disabled, the plugin calls projection directly with `bindingPersisted: false`.
A host failure creates no local claim; the host's own records determine retry and conflict behavior.

Binding schema version 2 contains `schemaVersion`, `session` (`provider`, `id`, `url`), `target`,
`markedAt`, and `workingDirectory`, plus optional `description` observation metadata. Hosts can
publish that description with the record and retain their first saved observation on retries;
description is separate from target identity. Providers are `codex` and `claude-code`; Claude Code's URL is
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

Adapter API version 2 is the current host contract. The local binding remains schema version 2;
configuration uses its existing [format and read compatibility](configuration.md#compatibility).
Each mark creates one core target and sends its binding to the enabled destinations. There is no
host-specific input schema, multiple-host broadcasting, or SDK dependency.
