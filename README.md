# session-marking

Bind the current Codex or Claude Code session to a project and task. By default, the CLI saves one
immutable local record per session. An optional host integration can validate its own target fields
and publish a record in that host.

**New here? Start with [global CLI installation](docs/installation.md#global-cli-with-pnpm), then
[mark your first session](docs/cli.md#mark-your-first-session).** Local use needs no host integration.

| I want to… | Read |
| --- | --- |
| Install the CLI or native plugin, update, or uninstall | [Installation](docs/installation.md) |
| Run a command, understand its result, or resolve an error | [CLI guide](docs/cli.md) |
| Change the local store or enable destinations | [Configuration](docs/configuration.md) |
| Mark a packet stage in adc-vault | [adc-vault integration](docs/integrations/adc-vault.md) |
| Implement a host integration | [Adapter contract](docs/adapter-contract.md) |
| Change the implementation or release it | [Development](#develop) |

## Install globally with pnpm

Install from a checkout with `pnpm add -g "$PWD"`. The [installation guide](docs/installation.md#global-cli-with-pnpm)
includes prerequisites, the complete commands, and how a local installation picks up changes.

## Configuration

Local storage starts enabled; host projection starts disabled. Run `session-marking configure` to
create or locate your editable configuration. See [configuration](docs/configuration.md) for the
complete file, destination switches, and storage paths.

### Optional adc-vault integration

Follow the [adc-vault setup guide](docs/integrations/adc-vault.md) when marking a Jira packet stage.
The host resolves one target for both enabled destinations.

## Install

For `$session-marking` in Codex or `/session-marking` in Claude Code, follow
[native plugin installation](docs/installation.md#native-plugin). This is optional for CLI use.

## Guarantees

The provider supplies the current session identity. Local storage, when enabled, keeps the first
binding and rejects a different target for that session. Enabled hosts own their records; destinations
are not synchronized. There is no prompt-submit hook or future-session arming state.
See [marking and retries](docs/cli.md#mark) and [destination behavior](docs/configuration.md#destinations).

## Migrate from adc-vault

Use the [marketplace migration steps](docs/installation.md#migrate-from-adc-vault) to preserve existing
configuration and session bindings while replacing the old plugin installation.

## Update

Follow [the update steps](docs/installation.md#update) for the global CLI and your installed providers.

## Use

The [CLI guide](docs/cli.md#mark-your-first-session) walks through the first mark and its saved result.
For the native plugin, invoke `$session-marking` in Codex or `/session-marking` in Claude Code and
provide the target fields reported by `describe`.

## Develop

Run `npm run verify` at this repository root. No dependency installation or host checkout is needed;
runtime dependencies are Node.js built-ins and tests use temporary adapters and state.
CI exercises Linux and macOS on Node.js 20 and 24. Architecture verification runs
`python3 .architecture/check.py` with Python 3.11 or newer.

Read [the architecture guide](docs/architecture/README.md) for responsibilities and interfaces,
[the adapter contract](docs/adapter-contract.md) for integration changes,
[the release guide](docs/release.md) for versioning, and
[extraction provenance](docs/extraction.md) for the retained Git history.
