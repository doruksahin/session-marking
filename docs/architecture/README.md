# Session marking architecture

## Responsibility

This repository owns the portable current-session marking plugin and its native distribution for
Codex and Claude Code. It creates one immutable machine-local claim per provider session. A host
adapter owns target validation and record publication. The workspace owns checkout assembly;
[the architecture owner](https://github.com/doruksahin/plugin-architecture/blob/main/standard/README.md)
owns cross-repository decisions and the shared checker.

## Interfaces

The public host interface is [scripts/session-marking.mjs](../../scripts/session-marking.mjs).
One configured adapter implements [API version 1](../adapter-contract.md). The
[skill](../../skills/session-marking/SKILL.md) discovers that adapter's selection fields and invokes
the same CLI. Provider manifests expose the skill; both native marketplaces install this root.

## Dependencies

Runtime code uses Node.js built-ins and imports the explicitly configured local adapter module.
There is no package dependency on the vault, workspace, architecture checker, or adapter SDK.
[The manifest](../../package.json) owns tool entrypoints. Development architecture checks require
Python, while provider installation and marking require only the Node.js runtime and the host.

## Execution and storage

The CLI runs locally. [Provider identity](../../src/session.mjs) comes from the host environment.
[Marking](../../src/mark.mjs) resolves the selected target, claims the immutable binding, then
projects the winning binding through the adapter. [Configuration and state paths](../../src/paths.mjs)
remain machine-local and independent of the source checkout. The adapter's transient context is
passed to projection and never persisted by the core.

## Failure behavior

Missing or ambiguous session identity, invalid configuration, invalid adapter exports, and
conflicting claims fail before projection. A projection failure retains the claim; an identical
retry can repair publication. [The adapter contract](../adapter-contract.md#target-and-retry-obligations)
records host obligations and [CLI errors](../adapter-contract.md#errors) define display behavior.

## Current implementation

The CLI, runtime modules, and skill form one cohesive plugin. The host calls its public CLI and
keeps its adapter in the host repository. [Extraction provenance](../extraction.md) identifies the
filtered source baseline and the unchanged runtime. Version mirrors and the independent release
lane are owned by [the release configuration](../../release-please-config.json).

## Planned changes

No runtime changes are planned as part of extraction. The architecture owner's extraction SPEC
tracks rollout work. Additional routing, SDK packages, and storage backends are outside this change.

## Decisions

The architecture owner maintains the accepted
[ownership ADR](https://github.com/doruksahin/plugin-architecture/blob/main/decree/adr/architecture/session-marking/adr-01m2czy06cdqyt4fcxvbfyfesm-give-the-portable-session-marking-plugin-independent.md)
and approved
[extraction SPEC](https://github.com/doruksahin/plugin-architecture/blob/main/decree/spec/architecture/session-marking/spec-01m2czy08rjxnwqw36b95zbtt4-extract-session-marking-and-preserve-the-configured-adapter.md).
They distinguish the independent repository from the existing runtime component and preserve
the configured-adapter boundary.

## Verification

`npm run verify` checks syntax, local version mirrors, provider marketplace roots, release ownership,
and portable behavior: concurrent claims, conflicting targets, retries, projection repair, provider
identity, and canonical bindings. [Boundary tests](../../tests/boundary.test.js) prevent host-domain
imports. CI requires no vault checkout.

`python3 .architecture/check.py` checks this repository's contract offline; the checker is copied
unchanged through the architecture owner's adoption tool. See [provenance](../../.architecture/SOURCE.md).
The architecture workflow also checks local documentation links and heading anchors with lychee.
