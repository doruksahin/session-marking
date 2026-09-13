# Adapter API version 1

[Start here](../README.md) · Operator setup: [configuration](configuration.md) · Commands: [CLI guide](cli.md)

The portable plugin enables local output by default and optionally projects the same binding through
one host adapter. An enabled host owns target selection, validation, and projection into its host.
The plugin owns provider identity, built-in local selection when no host is enabled, and the immutable
machine-local session claim when local persistence is enabled. See [the loader](../src/adapter.mjs) and
[the operation order](../src/mark.mjs) for executable authority.

## Local mode and configuration

See [configuration](configuration.md) for defaults, the user schema, enabled destinations, storage
paths, and legacy formats. The enabled host is the selection resolver; otherwise built-in local
selection resolves the target. Local output uses that same binding rather than resolving an
independent target. Disabled hosts are never imported.

## Register and invoke

Hosts invoke the [public CLI](cli.md#configure) instead of importing portable implementation files.
Register through `configure --adapter <name> --module <absolute-path>`, then use `describe` and
`mark` as documented in the [CLI guide](cli.md). Registration validates the path without loading
the adapter; `describe` and `mark` validate its exports when loading it.

Optional `--adapter` asserts the configured resolver and never changes enabled destinations.
The provider supplies session identity through its environment; command arguments cannot override
it. The CLI's success and failure envelopes are documented in [the command reference](cli.md).

## Exports

| Export | Input | Result |
| --- | --- | --- |
| `adapterApiVersion` | — | Numeric constant `1` |
| `describeSelection()` | No arguments | Canonicalizable JSON object describing host selection |
| `resolveTarget({ selection, workingDirectory })` | Canonical JSON selection and canonical absolute working directory | Exactly `{ target, context }`; `target` is a canonicalizable JSON object, `context` is a plain object |
| `projectBinding({ binding, context, bindingPersisted })` | The binding, resolution context, and whether the plugin persisted the binding locally | Canonicalizable JSON object describing projection |

`bindingPersisted` is an optional additive flag, sent as `false` for host-only execution. Local-enabled
calls retain the original `{ binding, context }` input shape. An omitted flag means `true`; adapters
should default it accordingly.
When false, `binding` is this invocation's candidate, including its current timestamp and working
directory. The host owns persistence, conflict detection, and preserving its first observation on
retries. Adapters must support those obligations before being used with local persistence disabled.

Functions may be synchronous or asynchronous. The outer input objects are frozen. JSON
normalization rules live in [canonical-json.mjs](../src/canonical-json.mjs). Context is transient:
it is passed to projection, is not stored in the binding, and need not be serializable.

## Target and retry obligations

`target` is the durable target identity. Resolution must produce the same target for equivalent
selections across retries. Use stable host identifiers; transient selection context belongs in
`context`. The adapter validates the current host selection before the plugin attempts a claim.

With local persistence enabled, the plugin persists the claim before calling projection. A conflicting target fails with
`BINDING_CONFLICT` and never reaches projection. An identical retry reuses the existing claim,
including its original timestamp and working directory, then calls projection again with fresh
resolution context. Therefore projection must be safe to repeat and repair partial host writes.
A projection failure leaves the durable claim in place; retrying the same target can repair it.
See [binding matching](../src/binding.mjs) and [claim storage](../src/store.mjs).

With local persistence disabled, the plugin calls projection directly with `bindingPersisted: false`.
A host failure creates no local claim; the host's own records determine retry and conflict behavior.

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

External adapters retain API version 1. Binding schema version 2 and target identities remain unchanged.
The additive `bindingPersisted` input described above preserves the original call shape for
local-enabled execution. See [configuration compatibility](configuration.md#compatibility) for legacy
formats and [configure](cli.md#configure) for the preserved response fields.

Each mark uses one resolver and sends its binding to the enabled destinations. There is
no host-specific routing, multiple-host broadcasting, or SDK dependency.
