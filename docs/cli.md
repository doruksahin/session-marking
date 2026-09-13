# CLI guide

[Start here](../README.md) · Setup: [installation](installation.md) · Settings: [configuration](configuration.md)

The commands are `configure`, `describe`, `mark`, and `list`. Normal execution returns one JSON success object on stdout;
help returns plain text.
Failures return `{ "ok": false, "code": "…", "message": "…" }` on stderr with exit status 1.

## Help

Start with `session-marking --help`, then ask for the command you need:

```sh
session-marking list --help
session-marking mark --help
```

Every command supports `--help` and `-h`. Running `session-marking` without arguments also shows
the command overview. Help exits successfully without reading user configuration, loading adapters,
or requiring a current session. Options and examples stay brief; this guide owns the detailed behavior.
For common selection fields and enabled host requirements, run [describe](#describe).

## Mark your first session

After [installing the CLI](installation.md#global-cli-with-pnpm), inspect the expected target fields:

```sh
session-marking describe
```

The result describes `project`, `task`, and optional `stageId`; an enabled host can require a stage.
With default configuration, it names adapter `local`.
Start a Codex or Claude Code session in your project and ask that session to run:

```sh
session-marking mark --selection-json '{"project":"website","task":"fix-login"}'
```

Replace the example identifiers with your selected project and task. The response contains
`binding: "created"` and an absolute `bindingPath`. Open that file to inspect the saved provider,
session ID, target, marking time, and working directory. Repeating the same command returns
`binding: "existing"` and keeps the original record.

The command uses the current provider environment by default. From an ordinary terminal, supply
[explicit session identity](#session-identity). If a host is enabled, satisfy the requirements reported
by `describe`, or explicitly [configure local use](#configure) first.

## Configure

```sh
session-marking configure
session-marking configure --adapter local
session-marking configure --adapter example --module /absolute/path/to/adapter.mjs
```

Choose the form for your intent; these are alternatives, not a setup sequence:

| Form | Effect | Success fields |
| --- | --- | --- |
| No flags | Initialize a missing file or show the existing effective configuration | `ok`, `configPath`, `config` |
| `--adapter local` | Enable local storage and disable the host, retaining saved host settings and local directory | `ok`, `adapter`, `configPath` |
| `--adapter <name> --module <absolute-path>` | Register and enable a host while preserving local settings | `ok`, `adapter`, `module`, `configPath` |

Host registration validates the module file path without importing it. Supplying `--module` always
registers an external adapter, including one named `local`. For the editable JSON and storage
precedence, see [configuration](configuration.md). For a concrete host setup, see
[adc-vault](integrations/adc-vault.md).

## Describe

```sh
session-marking describe
session-marking describe --adapter local
```

Returns `ok`, `adapter`, and `selection`: the common input description, including any enabled host
requirements. `project` and `task` are always required; a host can also require `stageId` and explain
its destination constraints.
It does not mark a session or initialize a missing configuration file. It loads the enabled host
when one is configured. Session identity is not required.

Optional `--adapter` asserts the configured adapter's name. For example, `--adapter local` fails when
a host named `adc-vault` is enabled. It never changes the configured destinations.

## Mark

```sh
session-marking mark --selection-json '{"project":"website","task":"fix-login"}'
```

`--selection-json` is required and uses the same fields with local storage or an enabled host:

| Field | Requirement |
| --- | --- |
| `project` | Required string of 1–256 characters, without leading or trailing whitespace |
| `task` | Required string with the same constraints |
| `stageId` | Optional slug matching `^[a-z][a-z0-9-]{0,63}$`; an enabled host can require it |

Extra fields are rejected. The core adds `kind: "session-marking/target-v1"` to the selected fields.
Local storage saves the complete target, including the stage when supplied. A host validates that
same target for its destination. See [adc-vault selection](integrations/adc-vault.md#mark-a-packet-stage)
for its concrete example.

`mark` also accepts optional `--adapter <name>` with the same assertion behavior as `describe`,
and [explicit identity flags](#session-identity).
One invocation creates one target and writes to the [configured destinations](configuration.md#destinations).

Add an optional description of this session's work separately from the target:

```sh
session-marking mark \
  --selection-json '{"project":"adcreative","task":"ATT-5551","stageId":"implementation"}' \
  --description 'Investigating login retries and adding tests.'
```

The description is saved as observation metadata in the local binding and supported host records.
Its text is preserved, including an empty string, and it does not change target identity. Local
storage and adc-vault each retain their first saved description, including its absence, on retries.
With local enabled, the response uses the saved binding's description. There is no separate
edit-description command.

A default local success has this shape (paths and session identity below are illustrative):

```json
{
  "ok": true,
  "adapter": "local",
  "provider": "codex",
  "sessionId": "example-session",
  "sessionUrl": "codex://threads/example-session",
  "binding": "created",
  "bindingPath": "/absolute/local-store/bindings/codex/example-session.json",
  "local": {
    "bindingPath": "/absolute/local-store/bindings/codex/example-session.json"
  },
  "target": {
    "kind": "session-marking/target-v1",
    "project": "website",
    "task": "fix-login"
  },
  "projection": null
}
```

With local enabled, `binding` is `created` or `existing`, and `local.bindingPath` points to the same
record as `bindingPath`. A retry for the same target preserves its original timestamp and working
directory. A different target for that session fails with `BINDING_CONFLICT` before host projection.
Competing local claims have one winner.

With a host enabled, `projection` contains its result. The local binding is claimed first when local
is enabled; a host failure leaves that binding in place. Retrying the same target can repair the host
record. With local disabled, `binding`, `bindingPath`, and `local` are all `null`, and the host owns
persistence and retries. There are no local reads, writes, or hidden receipts in that case.

Marking creates binding records; it does not modify the LLM transcript or infer a task from your
branch, working directory, or conversation. The saved local JSON uses binding schema version 2,
with `session`, `target`, `markedAt`, and `workingDirectory` alongside `schemaVersion`, plus
`description` when supplied.

## List

List saved local sessions from an ordinary terminal; no current LLM session is required:

```sh
session-marking list | jq
session-marking list --filter target.task=ATT-5551 | jq
session-marking list --filter target.task=ATT-5551 --sort target.stageId | jq
```

The response is `{ "ok": true, "sessions": [...] }`. Each item is the full saved binding described
under [mark](#mark), including its session identity, target, marking time, and working directory.
A missing store or no matches returns an empty `sessions` array.

| Option | Behavior |
| --- | --- |
| `--filter <field>=<value>` | Exact, case-sensitive scalar text match; repeat for conditions that must all match |
| `--sort <field>` | Sort alphabetically by scalar text, ascending by default |
| `--order asc\|desc` | Override sort direction; without `--sort`, sort by `markedAt` |

With no sort options, the newest marks appear first (`markedAt` descending). Field paths start
with a saved binding field, such as `target.task`, `description`, or `session.provider`.
Numbers, booleans, and null compare as their text values. Missing fields, objects, and arrays do not match
filters and sort last in either direction; ties use provider then session ID. Stage IDs sort
alphabetically, without inferring workflow order.

For a compact result, let `jq` select the fields to display:

```sh
session-marking list --filter target.task=ATT-5551 --sort target.stageId \
  | jq '.sessions | map({task: .target.task, stageId: .target.stageId, sessionId: .session.id})'
```

Illustrative output:

```json
[
  {
    "task": "ATT-5551",
    "stageId": "implementation",
    "sessionId": "example-session"
  }
]
```

Listing reads the [configured local store](configuration.md#file-locations), even when local writes
are disabled. It never loads the host adapter or reads host records, so sessions saved only to a
host do not appear. An invalid saved record fails the command instead of returning a partial list.

## Session identity

With no identity flags, marking uses the current provider environment:

| Provider | Required variables | Session URL |
| --- | --- | --- |
| Codex | `CODEX_THREAD_ID` and `CODEX_SESSION_ID`, both valid and equal | `codex://threads/<id>` |
| Claude Code | `CLAUDE_CODE_SESSION_ID` | `null` |

To mark a known session from an ordinary terminal, pass both flags. Replace this illustrative ID
with the session you intend to mark:

```sh
session-marking mark --provider codex --session-id example-session \
  --selection-json '{"project":"adcreative","task":"ATT-5551","stageId":"implementation"}'
```

`--provider` accepts `codex` or `claude-code`; the ID alone cannot identify its provider. A complete
`--provider` / `--session-id` pair takes precedence over the environment. Supplying only one flag
fails. With neither flag, the existing environment rules apply: missing, inconsistent, or ambiguous
provider identity fails.

IDs must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. The CLI validates the supplied identity's
format but does not check whether the session exists. A new record's marking time and working directory
describe this invocation, not the session's creation time or original directory. Target validation,
description, storage, and retries behave the same for either identity source.
[session.mjs](../src/session.mjs) owns identity validation; [explicit identity tests](../tests/explicit-identity.test.js)
exercise the CLI's pair validation, environment precedence, and saved results.

## Errors and troubleshooting

| Code | What to check |
| --- | --- |
| `ARGUMENT_INVALID` | Use valid option values and selection JSON; explicit identity requires both provider and session ID |
| `CONFIG_INVALID` | Check [the JSON schema and enabled destinations](configuration.md) |
| `ADAPTER_MISMATCH` | Run `describe`; remove a stale assertion or explicitly configure the intended adapter |
| `ADAPTER_INVALID` / `ADAPTER_LOAD_FAILED` | Check the registered module path and [adapter exports](adapter-contract.md#exports) |
| `SELECTION_INVALID` | Supply exactly the fields and values reported by `describe` |
| `SESSION_ID_UNAVAILABLE` / `SESSION_ID_MISMATCH` / `SESSION_PROVIDER_AMBIGUOUS` | Check [session identity](#session-identity) and its selected source |
| `BINDING_CONFLICT` | The selected local store already binds this session to another target; use its existing target or a new provider session |
| `BINDING_INVALID` | The existing record failed validation; inspect it without overwriting it |
| `FILE_INVALID` / `PATH_UNSAFE` | Check that the local store is readable and uses regular files and canonical directories, without symlinks |
| `PATH_INVALID` | Check that directory overrides are absolute and not filesystem roots |

Hosts may return their own actionable error codes. Unexpected failures are masked as
`SESSION_MARK_FAILED`; see [adapter errors](adapter-contract.md#errors) for the error boundary.
The executable entry point is [scripts/session-marking.mjs](../scripts/session-marking.mjs).
