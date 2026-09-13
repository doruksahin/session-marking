# Installation

[Start here](../README.md) · Next: [mark your first session](cli.md#mark-your-first-session)

## Global CLI with pnpm

Use Node.js 20 or newer and pnpm. Clone the repository and install from its root:

```sh
git clone https://github.com/doruksahin/session-marking.git
cd session-marking
pnpm add -g "$PWD"
session-marking describe
```

If pnpm reports that its global bin directory is missing, run `pnpm setup`, reopen your terminal,
and retry. With no saved configuration, `describe` reports `local` and the required `project` and
`task` fields. It does not create configuration or mark a session. Existing configuration remains
active after installation or update; use [configuration](configuration.md) to change it explicitly.

The CLI is now available from any working directory. Keep the checkout in place: this installation
uses the local source. Source and version changes take effect on the next command invocation.
Rerun `pnpm add -g "$PWD"` if the command name or entry-point path changes.

Continue with [your first mark](cli.md#mark-your-first-session). A native plugin is optional for CLI use;
marking uses the current provider environment or [an explicit identity](cli.md#session-identity).

## Native plugin

The optional native plugin exposes `$session-marking` in Codex or `/session-marking` in Claude Code.
Use a provider installation with plugin support. From the session-marking repository root, register
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

Check that `session-marking@session-marking` is installed and enabled, then start a new provider
session. Keep the checkout in place: these commands register it as a local marketplace. The installed
plugin is user-scoped and can be invoked from any working directory. It uses the same configuration
and marking implementation as the global CLI.

Invoke the skill and provide the target fields reported by `describe`; see [CLI selection](cli.md#mark).

## Update

From the session-marking repository root, update the local source:

```sh
git pull --ff-only
```

The globally installed command uses that source on its next invocation. For native plugins, refresh
each provider's installed copy using only the commands for providers you have installed.

For Codex:

```sh
codex plugin remove session-marking@session-marking
codex plugin add session-marking@session-marking
codex plugin list --marketplace session-marking --json
```

For Claude Code:

```sh
claude plugin marketplace update session-marking
claude plugin update session-marking@session-marking --scope user
claude plugin list --json
```

Check the installed version against [package.json](../package.json), then start a new provider session.
Configuration and local bindings are independent of plugin installation and do not need to be recreated.

## Uninstall

To remove the global command:

```sh
pnpm remove -g session-marking
```

Native installations are separate. Remove the plugin only from the providers you use:

```sh
codex plugin remove session-marking@session-marking
claude plugin uninstall session-marking@session-marking --scope user --keep-data
```

These commands do not move the plugin's [configuration or local store](configuration.md#file-locations).

## Migrate from adc-vault

Install and verify the new [native marketplace](#native-plugin) before removing the old plugin.
Run the commands only for providers where `session-marking@adc-vault` is installed:

```sh
codex plugin remove session-marking@adc-vault
claude plugin uninstall session-marking@adc-vault --scope user --keep-data
```

Start a new provider session after changing installed plugins. Existing machine-local adapter
configuration and immutable bindings remain usable; do not reset either for this migration.
The plugin name stays `session-marking`; only the marketplace changes.
See [configuration compatibility](configuration.md#compatibility).
