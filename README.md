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

Use Node.js 20 or newer. Register this repository's native marketplaces for each provider you use.
The installed plugin is user-scoped and can be invoked from any working directory.

```sh
codex plugin marketplace add /absolute/path/to/session-marking
codex plugin add session-marking@session-marking

claude plugin marketplace add /absolute/path/to/session-marking --scope user
claude plugin install session-marking@session-marking --scope user
```

The host registers its adapter separately through the public CLI. For adc-vault:

```sh
node "/absolute/path/to/adc-vault/00 System/Integrations/session-marking/configure.mjs" \
  --cli /absolute/path/to/session-marking/scripts/session-marking.mjs
```

This writes machine-local adapter configuration only. Rerun it when the adapter checkout moves.
For another host, follow [the adapter contract](docs/adapter-contract.md#register-and-invoke).
Existing machine-local claims and configuration remain usable after extraction; see
[compatibility](docs/adapter-contract.md#compatibility).

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
