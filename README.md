# session-marking

Portable Codex and Claude Code plugin for explicitly binding the current provider session to one
operator-selected target. The core stores one immutable, machine-local claim per provider session;
a configured adapter validates and projects that claim into a host system such as adc-vault.

## Guarantees

- The provider supplies the current session identity; callers cannot override it.
- Different sessions can be marked concurrently.
- Competing claims for one session have exactly one winner.
- Repeating the winning claim is idempotent and can repair a failed host projection.
- The package contains no prompt-submit hook, global active target, or future-session arming state.
- Host-specific task, stage, and record rules remain behind the adapter boundary.

## Install

Clone the repository once, then register its native marketplaces for each provider that a colleague
uses. The installed plugin is user-scoped and can be invoked from any working directory.

```sh
git clone https://github.com/AdCreative-ai/adcreative-obsidian-work-os.git adc-vault

codex plugin marketplace add /absolute/path/to/adc-vault
codex plugin add session-marking@adc-vault

claude plugin marketplace add /absolute/path/to/adc-vault --scope user
claude plugin install session-marking@adc-vault --scope user
```

The host registers its adapter separately. For adc-vault:

```sh
cd /absolute/path/to/adc-vault
node "00 System/Integrations/session-marking/configure.mjs"
```

This writes machine-local adapter configuration only. Rerun it if the host checkout moves.

## Use

Invoke `$session-marking` in Codex or `/session-marking` in Claude Code and provide the target fields
requested by the configured adapter. The adc-vault adapter requests a Jira key and a direct packet
stage slug, then publishes a packet-owned session record.

## Develop

```sh
cd plugins/session-marking
npm run verify
```

`package.json` owns the plugin version. `npm run sync:version` copies it into both provider manifests
and any explicitly supplied host marketplace. Release Please publishes component-qualified
`session-marking-vX.Y.Z` tags independently of the host repository's root version.

## References

- [OpenAI plugins](https://learn.chatgpt.com/docs/build-plugins)
- [OpenAI Agent Skills](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Release Please manifest releases](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)

