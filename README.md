# session-marking

Bind the current Codex or Claude Code session to a project and task. The CLI saves one immutable,
machine-local binding per provider session. Local mode works immediately; an optional configured
host adapter can validate its own target fields and publish the same binding into that host.

## Install globally with pnpm

Use Node.js 20 or newer and pnpm. Clone the repository and install the CLI from its root:

```sh
git clone https://github.com/doruksahin/session-marking.git
cd session-marking
pnpm add -g .
session-marking describe
```

If pnpm reports that its global bin directory is missing, run `pnpm setup`, reopen your terminal,
and retry. With no saved configuration, `describe` reports `local` and the required `project` and
`task` fields. It does not create configuration or mark a session. Existing adapter configuration
remains active after an update; use [configuration](#configuration) to switch it explicitly.

Start a Codex or Claude Code session in your project and ask that session to run:

```sh
session-marking mark --selection-json '{"project":"website","task":"fix-login"}'
```

Supply your own project and task identifiers. Each must be a nonblank string of 1–256 characters
with no leading or trailing whitespace; both fields are required and extra fields are rejected.
The command must run with the current provider's session identity in its environment. A regular
terminal without that identity cannot mark a session, and callers cannot supply an arbitrary
session ID. The native plugin is optional when calling the CLI directly.

A successful command returns JSON containing the target, binding status, and absolute `bindingPath`.
That file is the canonical local record. Local mode returns `projection: null` and creates no second
record store. Repeating the same mark reuses the binding; choosing another target for that session
fails with `BINDING_CONFLICT`.

Keep the checkout in place. With this local installation, source and version changes take effect
on the next command invocation. Rerun `pnpm add -g .` if the command name or entry-point path changes.
Provider-installed plugin copies follow the separate [update steps](#update).

To remove the global command:

```sh
pnpm remove -g session-marking
```

## Configuration

New installations use local mode without setup. To switch a previously configured machine back
to local mode explicitly:

```sh
session-marking configure --adapter local
session-marking describe
```

This explicitly replaces the active external configuration with local mode for subsequent commands.
Existing immutable bindings remain in place; switching mode does not migrate a bound session, and
marking it with a different target conflicts.
Invalid saved configuration produces an error instead of silently switching modes.

Configuration and bindings use the existing platform-specific application directories, independent
of the source checkout. For a different location, set `SESSION_MARKING_CONFIG_DIR` and/or
`SESSION_MARKING_STATE_DIR` to absolute directory paths in the environment that runs the CLI or
provider. Keep those values consistent across invocations: they select which configuration and
bindings are read. The returned `configPath` and `bindingPath` identify the files actually used.
[Path resolution](src/paths.mjs) owns the platform and XDG defaults.

### Optional adc-vault integration

The portable plugin does not include the adc-vault adapter. To use your own vault checkout, run
its setup script from the session-marking repository root, replacing the vault path:

```sh
node "/absolute/path/to/adc-vault/00 System/Integrations/session-marking/configure.mjs" \
  --cli "$PWD/scripts/session-marking.mjs"
session-marking describe
```

The configured adapter now supplies the selection fields. For an existing selected packet and stage,
run this inside the current provider session:

```sh
session-marking mark --selection-json '{"jiraKey":"ATT-5400","stageId":"implementation"}'
```

The core saves the canonical local binding, then the selected adapter publishes its vault record.
A command uses one mode and does not broadcast to multiple adapters. Jira fields are accepted by
the vault adapter; local mode expects `project` and `task`. Rerun setup when the adapter checkout
moves. Other integrations use [the adapter contract](docs/adapter-contract.md#register-and-invoke).

## Install

The optional native plugin lets you invoke `$session-marking` in Codex or `/session-marking` in
Claude Code. Use a provider installation with plugin support. From this repository root, register
the marketplace for the provider you use.

For Codex:

```sh
codex plugin marketplace add "$PWD"
codex plugin add session-marking@session-marking
codex plugin list --marketplace session-marking --json
```

For Claude Code:

```sh
claude plugin marketplace add "$PWD" --scope user
claude plugin install session-marking@session-marking --scope user
claude plugin list --json
```

Check that `session-marking@session-marking` is installed and enabled. Keep this checkout in place:
these commands register it as a local marketplace. The installed plugin is user-scoped and can be
invoked from any working directory. It uses the same configuration, local default, and marking
implementation as the global CLI.

## Guarantees

- The provider supplies the current session identity; callers cannot override it.
- Different sessions can be marked concurrently. Competing claims for one session have one winner.
- Repeating the winning claim is idempotent and can repair a failed host projection.
- Host-specific selection and record rules remain behind the adapter boundary.
- There is no prompt-submit hook, global active target, or future-session arming state.

## Migrate from adc-vault

Install and verify the new marketplace using the steps above before removing the old plugin.
Run the commands only for providers where `session-marking@adc-vault` is installed:

```sh
codex plugin remove session-marking@adc-vault
claude plugin uninstall session-marking@adc-vault --scope user --keep-data
```

Start a new provider session after changing installed plugins. Existing machine-local adapter
configuration and immutable session claims remain usable; do not reset either for this migration.
The plugin name stays `session-marking`; only the marketplace changes. See
[compatibility](docs/adapter-contract.md#compatibility).

## Update

For the local-checkout installation above, pull the updated source and refresh each provider's
installed copy. Run these commands from the session-marking repository root:

```sh
git pull --ff-only

codex plugin remove session-marking@session-marking
codex plugin add session-marking@session-marking
codex plugin list --marketplace session-marking --json

claude plugin marketplace update session-marking
claude plugin update session-marking@session-marking --scope user
claude plugin list --json
```

Use only the commands for your installed providers. Check the installed version against
`package.json`, then start a new provider session. Configuration is independent of plugin
installation and does not need to be recreated for updates.

## Use

Invoke `$session-marking` in Codex or `/session-marking` in Claude Code and provide the target fields
reported by `describe`: `project` and `task` for local mode, or the configured host's fields.
The skill invokes the same CLI and reports its saved binding and any host projection.

## Develop

Run `npm run verify` at this repository root. No dependency installation or host checkout is needed;
all runtime dependencies are Node.js built-ins and tests use temporary adapters and state.
CI exercises Linux and macOS on Node.js 20 and 24. Architecture verification runs
`python3 .architecture/check.py`; Python 3.11 or newer is required for that separate check.

See [the architecture guide](docs/architecture/README.md) for ownership and interfaces,
[the release guide](docs/release.md) for versioning, and
[extraction provenance](docs/extraction.md) for the retained Git history.
