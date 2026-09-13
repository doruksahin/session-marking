# Session marking architecture

## Responsibility

This repository owns the portable session-marking plugin and its native distribution for
Codex and Claude Code. By default, it creates one immutable machine-local claim per provider session. The core validates common project/task/stage selection; an optional host
adapter owns destination validation and record publication. The workspace owns checkout assembly;
[the architecture owner](https://github.com/doruksahin/plugin-architecture/blob/main/standard/README.md)
owns cross-repository decisions and the shared checker.

## Interfaces

The public host interface is [scripts/session-marking.mjs](../../scripts/session-marking.mjs).
Local output is enabled by default. An enabled external host adapter implements
[API version 2](../adapter-contract.md). The
[skill](../../skills/session-marking/SKILL.md) discovers common fields and enabled host requirements and invokes
the same CLI. Provider manifests expose the skill; both native marketplaces install this root.

## Dependencies

Runtime code uses Node.js built-ins; marking imports only the enabled host adapter module.
There is no package dependency on the vault, workspace, architecture checker, or adapter SDK.
[The manifest](../../package.json) owns tool entrypoints. Development architecture checks require
Python, while provider installation and marking require only the Node.js runtime and the host.

## Execution and storage

The CLI runs locally. [Provider identity](../../src/session.mjs) comes from an explicit provider/ID
pair when supplied, otherwise from the current provider environment.
[Marking](../../src/mark.mjs) validates the common target and claims its immutable local binding
only when local persistence is enabled. The host receives that winning binding, or the invocation's
candidate when local is disabled, with `bindingPersisted: false` only for host-only calls. Success returns
the local path and status when stored, otherwise null local fields, plus any host projection.
Marking with local persistence disabled performs no store access and creates no hidden receipt. Host-only
persistence and retries belong to the host adapter; destinations are not synchronized.
[Configuration and state paths](../../src/paths.mjs) remain machine-local and independent of the
source checkout. `SESSION_MARKING_STATE_DIR` overrides `local.directory`, which defaults to the
platform state directory when null. Configuration changes do not migrate bindings.
[Shipped defaults](../../config.defaults.json) enable local output and disable the host. User schema-3
configuration overlays known fields. Missing configuration uses defaults without writing; no-flag
`configure` initializes it exclusively when missing. Legacy configuration remains readable without
rewriting. Existing external configuration enables both outputs. Explicit host registration preserves
the local setting; disabling a host retains settings without importing or requiring its module. The adapter's transient context is
passed to projection and never persisted by the core.

[Listing](../cli.md#list) reads existing bindings from the configured local store regardless of
whether local writes are enabled. It requires no provider identity and never loads the host adapter.
The store validates saved records; a pure query module filters and sorts them without host-specific
fields or storage writes.

## Failure behavior

Missing or ambiguous session identity, invalid configuration, invalid selection, invalid adapter exports, and
conflicting local claims fail before projection. With local persistence enabled, a projection failure
retains the claim and an identical retry can repair publication. Host-only failures leave no local
claim; retry behavior belongs to the host. [The adapter contract](../adapter-contract.md#target-and-retry-obligations)
records host obligations and [CLI errors](../adapter-contract.md#errors) define display behavior.

## Current implementation

| Concern | Owning files |
| --- | --- |
| Command dispatch and JSON or help responses | [scripts/session-marking.mjs](../../scripts/session-marking.mjs) |
| Shared option definitions, argument parsing, and help text | [cli.mjs](../../src/cli.mjs) |
| Runtime operation order | [mark.mjs](../../src/mark.mjs) |
| Config parsing, defaults, and path selection | [config.mjs](../../src/config.mjs), [config.defaults.json](../../config.defaults.json), [paths.mjs](../../src/paths.mjs) |
| Common selection and host adapter loading | [target.mjs](../../src/target.mjs), [adapter.mjs](../../src/adapter.mjs) |
| Provider identity and binding format | [session.mjs](../../src/session.mjs), [binding.mjs](../../src/binding.mjs), [canonical-json.mjs](../../src/canonical-json.mjs) |
| Local binding reads, immutable writes, and filesystem operations | [store.mjs](../../src/store.mjs), [safe-files.mjs](../../src/safe-files.mjs) |
| Listing filters and sorting | [query.mjs](../../src/query.mjs) |
| Agent invocation | [SKILL.md](../../skills/session-marking/SKILL.md) |

Host adapters stay in their owning repositories and use the [adapter contract](../adapter-contract.md).
CLI parsing and help share command and option definitions. Help returns before user configuration,
adapter loading, or session lookup; examples are exercised through the executable in temporary stores.
The core creates one `session-marking/target-v1` target for both enabled destinations. The host
prepares transient publication context without changing that target.
[Extraction provenance](../extraction.md) identifies the retained source baseline. Version mirrors
and the independent release lane are owned by [the release configuration](../../release-please-config.json).

## Planned changes

Local persistence and optional host projection are controlled by user configuration. They share one
core target and binding input. Additional routing, SDK packages, and storage backends are outside
this change.

## Decisions

The architecture owner maintains the accepted
[ownership ADR](https://github.com/doruksahin/plugin-architecture/blob/main/decree/adr/architecture/session-marking/adr-01m2czy06cdqyt4fcxvbfyfesm-give-the-portable-session-marking-plugin-independent.md)
and approved
[extraction SPEC](https://github.com/doruksahin/plugin-architecture/blob/main/decree/spec/architecture/session-marking/spec-01m2czy08rjxnwqw36b95zbtt4-extract-session-marking-and-preserve-the-configured-adapter.md).
They distinguish the independent repository from the existing runtime component and preserve
the configured-adapter boundary. The approved
[local-default follow-up](https://github.com/doruksahin/plugin-architecture/blob/main/decree/spec/architecture/session-marking/spec-01m2d438dphxp6wkrbsws8xrca-default-session-marking-to-its-canonical-local-binding.md)
extends that runtime with local target selection while retaining one canonical binding store.

## Verification

`npm run verify` checks syntax, local version mirrors, provider marketplace roots, release ownership,
and portable behavior: concurrent claims, conflicting targets, retries, projection repair, provider
identity, canonical bindings, default local use, all output combinations, configuration initialization,
explicit switching, disabled-host isolation, and legacy configuration compatibility. [Boundary tests](../../tests/boundary.test.js) prevent host-domain
imports. CI requires no vault checkout.

`python3 .architecture/check.py` checks this repository's contract offline; the checker is copied
unchanged through the architecture owner's adoption tool. See [provenance](../../.architecture/SOURCE.md).
The architecture workflow also checks local documentation links and heading anchors with lychee.
