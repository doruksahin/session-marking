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
For adapter-specific selection fields, run [describe](#describe).

## Mark your first session

After [installing the CLI](installation.md#global-cli-with-pnpm), inspect the expected target fields:

```sh
session-marking describe
```

With default configuration, the result names adapter `local` and requires `project` and `task`.
Start a Codex or Claude Code session in your project and ask that session to run:

```sh
session-marking mark --selection-json '{"project":"website","task":"fix-login"}'
```

Replace the example identifiers with your selected project and task. The response contains
`binding: "created"` and an absolute `bindingPath`. Open that file to inspect the saved provider,
session ID, target, marking time, and working directory. Repeating the same command returns
`binding: "existing"` and keeps the original record.

The command must run with the current provider's [session identity](#session-identity). An ordinary
terminal without it cannot mark a session. If `describe` names a host adapter, use that adapter's
fields or explicitly [configure local use](#configure) first.

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

Returns `ok`, `adapter`, and `selection`: the active resolver's JSON description of its input fields.
It does not mark a session or initialize a missing configuration file. It loads the enabled host
when one is configured. Session identity is not required.

Optional `--adapter` asserts the active resolver's name. For example, `--adapter local` fails when
an enabled host named `adc-vault` resolves selection. It never changes the configured destinations.

## Mark

```sh
session-marking mark --selection-json '{"project":"website","task":"fix-login"}'
```

`--selection-json` is required. Built-in local selection accepts exactly `project` and `task`.
Each must be a string of 1–256 characters with no leading or trailing whitespace; extra fields are
rejected. The resolved target includes `kind: "local/project-task-v1"` and those two identifiers.
An enabled host supplies its own fields, reported by `describe`; local persistence saves that
host-resolved target as well. See [adc-vault selection](integrations/adc-vault.md#mark-a-packet-stage)
for its concrete example.

`mark` also accepts optional `--adapter <name>` with the same assertion behavior as `describe`.
One invocation resolves one target and writes to the [configured destinations](configuration.md#destinations).

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
    "kind": "local/project-task-v1",
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
with `session`, `target`, `markedAt`, and `workingDirectory` alongside `schemaVersion`.

## List

List saved local sessions from an ordinary terminal; no current LLM session is required:

```sh
session-marking list | jq
session-marking list --filter target.jiraKey=ATT-5551 | jq
session-marking list --filter target.jiraKey=ATT-5551 --sort target.stageId | jq
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
with a saved binding field, such as `target.jiraKey`, `target.project`, or `session.provider`.
Numbers, booleans, and null compare as their text values. Missing fields, objects, and arrays do not match
filters and sort last in either direction; ties use provider then session ID. Stage IDs sort
alphabetically, without inferring workflow order.

For a compact result, let `jq` select the fields to display:

```sh
session-marking list --filter target.jiraKey=ATT-5551 --sort target.stageId \
  | jq '.sessions | map({jiraKey: .target.jiraKey, stageId: .target.stageId, sessionId: .session.id})'
```

Illustrative output:

```json
[
  {
    "jiraKey": "ATT-5551",
    "stageId": "implementation",
    "sessionId": "example-session"
  }
]
```

Listing reads the [configured local store](configuration.md#file-locations), even when local writes
are disabled. It never loads the host adapter or reads host records, so sessions saved only to a
host do not appear. An invalid saved record fails the command instead of returning a partial list.

## Session identity

The provider must supply the identity in the command's environment:

| Provider | Required variables | Session URL |
| --- | --- | --- |
| Codex | `CODEX_THREAD_ID` and `CODEX_SESSION_ID`, both valid and equal | `codex://threads/<id>` |
| Claude Code | `CLAUDE_CODE_SESSION_ID` | `null` |

IDs must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. If both providers are present, identity is
ambiguous and marking fails. Callers cannot override session identity through CLI arguments.
Run the command from the current provider session; do not invent an ID to make a regular terminal
command pass. [session.mjs](../src/session.mjs) owns this validation.

## Errors and troubleshooting

| Code | What to check |
| --- | --- |
| `ARGUMENT_INVALID` | Use the command forms above; flags need values and selection must be valid JSON |
| `CONFIG_INVALID` | Check [the JSON schema and enabled destinations](configuration.md) |
| `ADAPTER_MISMATCH` | Run `describe`; remove a stale assertion or explicitly configure the intended resolver |
| `ADAPTER_INVALID` / `ADAPTER_LOAD_FAILED` | Check the registered module path and [adapter exports](adapter-contract.md#exports) |
| `SELECTION_INVALID` | Supply exactly the fields and values described by the active resolver |
| `SESSION_ID_UNAVAILABLE` / `SESSION_ID_MISMATCH` / `SESSION_PROVIDER_AMBIGUOUS` | Check [provider identity](#session-identity) in the current session |
| `BINDING_CONFLICT` | The selected local store already binds this session to another target; use its existing target or a new provider session |
| `BINDING_INVALID` | The existing record failed validation; inspect it without overwriting it |
| `FILE_INVALID` / `PATH_UNSAFE` | Check that the local store is readable and uses regular files and canonical directories, without symlinks |
| `PATH_INVALID` | Check that directory overrides are absolute and not filesystem roots |

Hosts may return their own actionable error codes. Unexpected failures are masked as
`SESSION_MARK_FAILED`; see [adapter errors](adapter-contract.md#errors) for the error boundary.
The executable entry point is [scripts/session-marking.mjs](../scripts/session-marking.mjs).
