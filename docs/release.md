# Release

`package.json` owns the portable plugin version. Release Please maintains the root package,
changelog, release manifest, both provider manifests, and the Claude marketplace version through
[its configuration](../release-please-config.json). Codex's local marketplace points to the root
plugin and has no separate version field. `npm run sync:version` repairs local mirrors and
`npm run verify:version` checks them.

1. Open a conventional-commit PR and pass `npm run verify`, the architecture check, and the
   documentation link check. Preserve conventional-commit history when merging into `main`.
2. Let [Release Please](../.github/workflows/release-please.yml) open the release PR. Review its
   changelog and synchronized versions, wait for checks, then merge it.
3. Verify the resulting `session-marking-vX.Y.Z` tag and GitHub Release. Register or update the
   repository's native marketplace on each provider and verify the installed plugin version.

Configure `RELEASE_PLEASE_TOKEN` with repository contents and pull-request write access before
running the release lane; a token that triggers checks for generated PRs is required. The extracted
repository has not been published or configured with this secret, so this workflow is not yet
active. This repository distributes source through native marketplaces and Git tags; it has no npm publish
or binary release step. The version remains 1.2.0 during extraction. The first new release is
calculated from conventional commits after the bootstrap revision recorded in the release config.

Moving from `session-marking@adc-vault` changes the marketplace registration, not the plugin's
machine-local configuration or binding state. Verify the new installation before retiring the old
registration. See [extraction provenance](extraction.md) for source history and
[the adapter contract](adapter-contract.md#compatibility) for compatibility guarantees.
