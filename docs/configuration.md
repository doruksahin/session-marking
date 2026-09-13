# Configuration

[Start here](../README.md) · Commands: [configure](cli.md#configure) · Host setup: [adc-vault](integrations/adc-vault.md)

## Create or locate your file

```sh
session-marking configure
```

The command returns `configPath` and the effective configuration. It creates the user file only
when missing; an existing file is validated and shown without being rewritten. Edit the returned
file. Every command reads it again, so changes apply on the next invocation.

[config.defaults.json](../config.defaults.json) is the shipped defaults source. The complete default is:

```json
{
  "schemaVersion": 3,
  "local": {
    "enabled": true,
    "directory": null
  },
  "host": {
    "enabled": false,
    "name": null,
    "module": null
  }
}
```

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Required; use `3` for this format |
| `local.enabled` | Whether to read and persist the local session binding |
| `local.directory` | Absolute local store directory; `null` uses the platform default |
| `host.enabled` | Whether to resolve and project through the host adapter |
| `host.name` | Adapter name; required when the host is enabled |
| `host.module` | Absolute adapter module path; required when the host is enabled |

The user file may omit fields other than `schemaVersion`; omitted fields use shipped defaults.
Explicit `false` is preserved. Unknown fields, wrong types, malformed JSON, and unsupported schemas
fail instead of falling back. A host name starts with a lowercase letter and contains only lowercase
letters, digits, or hyphens, up to 64 characters. An enabled module must be a canonical absolute path
to an existing regular file. Registration through [configure](cli.md#configure) canonicalizes that path.

## Destinations

| Local enabled | Host enabled | Marking behavior |
| --- | --- | --- |
| `true` | `false` | Save the local binding |
| `true` | `true` | Save the local binding, then project that binding through the host |
| `false` | `true` | Project through the host without accessing the local store |
| `false` | `false` | Configuration error |

The enabled host supplies the selection fields and resolves one target. Otherwise, built-in local
selection does so. Both enabled destinations receive the same binding; enabling local alongside a
host does not require a second selection. See [mark](cli.md#mark) for fields and returned results.

With local disabled, the CLI performs no local binding reads or writes and creates no hidden receipt.
The host owns persistence and retry behavior. Existing records remain untouched while their
destination is disabled. Changing configuration does not synchronize records between destinations.

A disabled host may retain its name and module settings; the module is neither imported nor required
to exist. [Local setup](cli.md#configure) disables the host while retaining these settings. Registering
a host enables it and preserves the current local settings.

## File locations

The configuration is `<config-directory>/config.json`. Local bindings are stored separately at
`<local-directory>/bindings/<provider>/<session-id>.json`, with provider `codex` or `claude-code`.
Both locations are independent of the source checkout.

| Platform | Default configuration directory | Default local directory |
| --- | --- | --- |
| macOS | `~/Library/Application Support/session-marking` | `~/Library/Application Support/session-marking/state` |
| Linux / other Unix | `$XDG_CONFIG_HOME/session-marking`, otherwise `~/.config/session-marking` | `$XDG_STATE_HOME/session-marking`, otherwise `~/.local/state/session-marking` |
| Windows | `%APPDATA%/session-marking`, otherwise `~/AppData/Roaming/session-marking` | `%LOCALAPPDATA%/session-marking/state`, otherwise `~/AppData/Local/session-marking/state` |

For the local directory, precedence is:

1. `SESSION_MARKING_STATE_DIR` environment override.
2. `local.directory` when non-null.
3. The platform default.

`SESSION_MARKING_CONFIG_DIR` separately overrides the configuration directory. Directory paths must
be absolute and cannot be a filesystem root. Use an expanded absolute path in JSON, not `~` or a
shell variable. [paths.mjs](../src/paths.mjs) owns path resolution.

Changing the local directory selects another store. It does not move or delete old bindings, and
conflict checks apply within the selected store. Keep the location consistent across invocations
when you want existing bindings to protect against reassignment.

## Compatibility

Version-1 external adapter configuration remains readable as local plus host enabled. Version-2
local configuration remains readable as local enabled and host disabled. Reads do not rewrite either
format; explicit configuration writes use version 3.

Existing binding schema version 2 and target identities remain unchanged. Moving or updating the
source checkout does not require a state reset. Reregister a host when its module moves; explicit
registration or local setup can replace or disable a moved host without loading its old module.
For adapter authors, see [the API compatibility contract](adapter-contract.md#compatibility).
