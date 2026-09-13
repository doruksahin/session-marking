# Session marking architecture

## Responsibility

This repository owns the portable current-session marking plugin and its native distribution for
Codex and Claude Code. It creates one immutable machine-local claim per provider session. Built-in local mode validates project/task selection; an optional host
adapter owns its target validation and record publication. The workspace owns checkout assembly;
[the architecture owner](https://github.com/doruksahin/plugin-architecture/blob/main/standard/README.md)
owns cross-repository decisions and the shared checker.

## Interfaces

The public host interface is [scripts/session-marking.mjs](../../scripts/session-marking.mjs).
Local mode is the default when configuration is absent. A configured external adapter implements
[API version 1](../adapter-contract.md). The
[skill](../../skills/session-marking/SKILL.md) discovers the selected mode's fields and invokes
the same CLI. Provider manifests expose the skill; both native marketplaces install this root.

## Dependencies

Runtime code uses Node.js built-ins; external mode imports only its explicitly configured adapter module.
There is no package dependency on the vault, workspace, architecture checker, or adapter SDK.
[The manifest](../../package.json) owns tool entrypoints. Development architecture checks require
Python, while provider installation and marking require only the Node.js runtime and the host.

## Execution and storage

The CLI runs locally. [Provider identity](../../src/session.mjs) comes from the host environment.
[Marking](../../src/mark.mjs) resolves the selected target, claims the immutable binding, and
projects it through the selected adapter only in external mode. Success then returns the canonical
binding path. Local mode has no projection or additional record store. [Configuration and state paths](../../src/paths.mjs)
remain machine-local and independent of the source checkout, with explicit environment overrides.
Missing configuration selects local mode without writing configuration; existing external
configuration remains active. The adapter's transient context is
passed to projection and never persisted by the core.

## Failure behavior

Missing or ambiguous session identity, invalid configuration, invalid local selection, invalid adapter exports, and
conflicting claims fail before projection. A projection failure retains the claim; an identical
retry can repair publication. [The adapter contract](../adapter-contract.md#target-and-retry-obligations)
records host obligations and [CLI errors](../adapter-contract.md#errors) define display behavior.

## Current implementation

The CLI, runtime modules, and skill form one cohesive plugin. The host calls its public CLI and
keeps its adapter in the host repository. Built-in local selection uses the same binding operation
and storage as external mode. [Extraction provenance](../extraction.md) identifies the
retained source baseline; the local default is a subsequent runtime change. Version mirrors and the independent release
lane are owned by [the release configuration](../../release-please-config.json).

## Planned changes

Default local mode and explicit external configuration are the bounded change. Additional routing,
SDK packages, and storage backends are outside this change.

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
identity, canonical bindings, default local use, explicit configuration switching, and configuration
compatibility. [Boundary tests](../../tests/boundary.test.js) prevent host-domain
imports. CI requires no vault checkout.

`python3 .architecture/check.py` checks this repository's contract offline; the checker is copied
unchanged through the architecture owner's adoption tool. See [provenance](../../.architecture/SOURCE.md).
The architecture workflow also checks local documentation links and heading anchors with lychee.
