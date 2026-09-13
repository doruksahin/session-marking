# adc-vault integration

[Start here](../../README.md) · Settings: [configuration](../configuration.md) · Commands: [CLI guide](../cli.md)

Use this integration to associate the current session with an existing adc-vault packet and an
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
`describe` should now name `adc-vault` and require `jiraKey` and `stageId`.
Pass the actual `scripts/session-marking.mjs` file to `--cli`: the helper executes it with Node.js,
so a pnpm shell shim returned by `command -v session-marking` is not a substitute.

Setup enables the host and preserves local settings. On a fresh installation, local storage stays
enabled, so both destinations will receive the resolved binding. Edit the returned configuration to
[change destinations or local storage](../configuration.md). Rerun setup when the vault checkout moves.

## Mark a packet stage

Choose an existing packet and its stage. Inside the current Codex or Claude Code session, run:

```sh
session-marking mark --selection-json '{"jiraKey":"ATT-5400","stageId":"implementation"}'
```

Replace the example key and stage with your selection. The vault validates the packet and its direct
stage folder. It resolves the target as:

```json
{
  "kind": "adc-vault/packet-stage-v1",
  "workspace": "adcreative",
  "jiraKey": "ATT-5400",
  "stageId": "implementation"
}
```

The field names belong to this host resolver. Built-in local selection uses `project` and `task`;
enabling local storage alongside adc-vault does not invoke that second resolver or require another
selection. The one target above is used for both enabled destinations.

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
