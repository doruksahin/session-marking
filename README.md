# session-marking

Portable Codex and Claude Code plugin for explicitly binding the current provider session to one
operator-selected target. The core stores one immutable, machine-local claim per provider session;
a configured adapter validates and projects that claim into its host.

## Guarantees

- The provider supplies the current session identity; callers cannot override it.
- Different sessions can be marked concurrently. Competing claims for one session have one winner.
- Repeating the winning claim is idempotent and can repair a failed host projection.
- Host-specific selection and record rules remain behind the adapter boundary.
- There is no prompt-submit hook, global active target, or future-session arming state.

## Install

Use Node.js 20 or newer and a Codex or Claude Code installation with plugin support.
Clone the portable plugin, then register the native marketplace for each provider you use:

```sh
git clone https://github.com/doruksahin/session-marking.git
cd session-marking

codex plugin marketplace add "$PWD"
codex plugin add session-marking@session-marking
codex plugin list --marketplace session-marking --json

claude plugin marketplace add "$PWD" --scope user
claude plugin install session-marking@session-marking --scope user
claude plugin list --json
```

Check that `session-marking@session-marking` is installed and enabled in each provider's list.
Keep this checkout in place: the commands register it as a local marketplace. The installed
plugin is user-scoped and can be invoked from any working directory.

The host registers its adapter separately through the public CLI. With the current adc-vault
checkout available, run this from the session-marking repository root, replacing the vault path:

```sh
node "/absolute/path/to/adc-vault/00 System/Integrations/session-marking/configure.mjs" \
  --cli "$PWD/scripts/session-marking.mjs"
node "$PWD/scripts/session-marking.mjs" describe
```

`describe` confirms that the configured adapter loads and returns its selection fields without
marking a session. Configuration is machine-local; rerun setup when the adapter checkout moves.
The portable plugin does not include the adc-vault adapter. For another host, follow
[the adapter contract](docs/adapter-contract.md#register-and-invoke).

## Install globally with pnpm

To run `session-marking` from any directory, install the CLI from your local checkout.
After cloning the repository, run this from its root:

```sh
pnpm add -g .
```

If pnpm reports that its global bin directory is missing, run `pnpm setup`, reopen your
terminal, and retry. Node.js 20 or newer is required.

Complete the adapter configuration in [Install](#install), then verify the global command:

```sh
session-marking describe
```

The command supports the same `configure`, `describe`, and `mark` operations as the Node.js
script. `mark` must run with the current Codex or Claude Code session identity in its environment;
a regular terminal without that identity cannot mark a session. Installing the global CLI does
not register the Codex or Claude Code skill; use the provider installation steps above for that.

Keep the checkout in place. With this local installation, source and version changes take effect
on the next command invocation; no reload or reinstall is needed. Rerun `pnpm add -g .` if the
command name or entry-point path changes. Provider-installed plugin copies still follow the
separate [update steps](#update).

To remove the global command:

```sh
pnpm remove -g session-marking
```

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

Check the installed version against `package.json`, then start a new provider session. Adapter
configuration is independent of plugin installation and does not need to be recreated for updates.

## Use

Invoke `$session-marking` in Codex or `/session-marking` in Claude Code and provide the target fields
requested by the configured adapter. The adapter owns how the selected target appears in its host.

## Develop

Run `npm run verify` at this repository root. No dependency installation or host checkout is needed;
all runtime dependencies are Node.js built-ins and tests use temporary adapters and state.
CI exercises Linux and macOS on Node.js 20 and 24. Architecture verification runs
`python3 .architecture/check.py`; Python 3.11 or newer is required for that separate check.

See [the architecture guide](docs/architecture/README.md) for ownership and interfaces,
[the release guide](docs/release.md) for versioning, and
[extraction provenance](docs/extraction.md) for the retained Git history.
