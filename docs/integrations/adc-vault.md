# adc-vault integration

[Start here](../../README.md) · Settings: [configuration](../configuration.md) · Commands: [CLI guide](../cli.md)

Use this integration to associate a session with an existing adc-vault packet and an
operator-selected stage. The adapter lives in your vault checkout; it is not bundled with this plugin.
Local use remains available without a vault.

## Set up once

Install the [global CLI](../installation.md#global-cli-with-pnpm). From the session-marking repository
root, run the vault's setup helper, replacing the vault path with your checkout's absolute path:

```sh
node "/absolute/path/to/adc-vault/00 System/Integrations/session-marking/configure.mjs" \
  --cli "$PWD/scripts/session-marking.mjs"
session-marking describe
```

The helper registers the vault-owned `adapter.mjs` and returns its module path and your `configPath`.
`describe` should now name `adc-vault` and require `project`, `task`, and `stageId`.
Pass the actual `scripts/session-marking.mjs` file to `--cli`: the helper executes it with Node.js,
so a pnpm shell shim returned by `command -v session-marking` is not a substitute.

Setup enables the host and preserves local settings. On a fresh installation, local storage stays
enabled, so both destinations will receive the resolved binding. Edit the returned configuration to
[change destinations or local storage](../configuration.md). Rerun setup when the vault checkout moves.

## Mark a packet stage

Choose an existing packet and its stage. Inside the current Codex or Claude Code session, run:

```sh
session-marking mark --selection-json '{"project":"adcreative","task":"ATT-5400","stageId":"implementation"}'
```

Use project `adcreative`, a canonical Jira key as `task`, and your selected `stageId`. The vault
validates the existing packet and its direct stage folder. The core target saved locally is:

```json
{
  "kind": "session-marking/target-v1",
  "project": "adcreative",
  "task": "ATT-5400",
  "stageId": "implementation"
}
```

The same input works with local storage alone. Enabling adc-vault adds its destination validation:
project `adcreative`, a canonical Jira task key, and an existing packet stage. The adapter maps
`task` to the vault's `jiraKey`; both enabled destinations receive the same core binding.
For a known session outside the current environment, supply [explicit identity flags](../cli.md#session-identity).
An optional [`--description`](../cli.md#mark) is saved in the local binding and the vault session
record as the session's work description.

## Find the results

With local storage enabled, `local.bindingPath` and `bindingPath` identify the JSON binding in your
[local store](../configuration.md#file-locations). The host publishes a Markdown session record at:

```text
10 Tasks/Packets/<jiraKey>/sessions/<provider>/<session-id>.md
```

The success response includes the host result under `projection`:

```json
{
  "jiraKey": "ATT-5400",
  "stageId": "implementation",
  "record": "created",
  "recordPath": "10 Tasks/Packets/ATT-5400/sessions/codex/example-session.md"
}
```

This projection example uses an illustrative session ID. `recordPath` is relative to the vault;
`record` is `created` or `existing`. The vault retains its first recorded observation on retries.

With local storage disabled, only the vault record is written; `binding`, `bindingPath`, and `local`
are `null`. Existing local records are neither checked nor changed. Vault records are owned per
packet, without cross-packet or local-store synchronization. Re-enabling local storage does not
backfill or reconcile records; subsequent commands use the newly enabled destinations.

For portable retry behavior and failure output, see [mark](../cli.md#mark). To build another
integration, use [the adapter contract](../adapter-contract.md).
