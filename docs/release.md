# Release

`package.json` owns the portable plugin version. Release Please maintains the root package,
changelog, release manifest, both provider manifests, and the Claude marketplace version through
[its configuration](../release-please-config.json). Codex's local marketplace points to the root
plugin and has no separate version field. `npm run sync:version` repairs local mirrors and
`npm run verify:version` checks them.

1. Open a conventional-commit PR and pass `npm run verify`, the architecture check, and the
   documentation link check. Preserve conventional-commit history when merging into `main`.
2. Let [Release Please](../.github/workflows/release-please.yml) open the release PR. Review its
   changelog and synchronized versions, then approve or dispatch the checks below.
3. Wait for Verify and Architecture to pass on the release PR's current head commit before
   merging it. Any later PR update requires another check of that new head.
4. Verify the resulting `session-marking-vX.Y.Z` tag and GitHub Release. Follow the
   [installation update steps](../README.md#update) for each provider.

## Release PR checks

The release workflow uses GitHub's built-in repository token. Enable **Settings → Actions →
General → Allow GitHub Actions to create and approve pull requests**. Workflow permissions are
limited to this repository's contents, issues, and pull requests; no additional token secret is
required.

Checks for pull requests opened or updated with `GITHUB_TOKEN` may require approval. If checks
are held, a maintainer with write access selects **Approve workflows to run** in the release PR's
merge box, then waits for Verify and Architecture to pass. Check for held runs again after a later
automated update changes the PR.

If checks need to be started directly, both workflows also support manual dispatch. In the commands
below, replace `RELEASE_PR_NUMBER` with the generated PR number and `RELEASE_PR_BRANCH` with
its returned `headRefName`:

```sh
gh pr view RELEASE_PR_NUMBER --repo doruksahin/session-marking --json headRefName,headRefOid
gh workflow run verify.yml --repo doruksahin/session-marking --ref RELEASE_PR_BRANCH
gh workflow run architecture.yml --repo doruksahin/session-marking --ref RELEASE_PR_BRANCH
gh run list --repo doruksahin/session-marking --branch RELEASE_PR_BRANCH \
  --json workflowName,headSha,status,conclusion,url
```

For manually dispatched checks, confirm a completed successful run for both workflow names whose `headSha` equals the PR's
current `headRefOid`. Open the returned run URLs to inspect failures. Dispatching checks starts
work; it does not establish a passing result. Passing checks on the current PR are required before merging a
release PR. See [GitHub's workflow triggering rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

Distribution uses native marketplaces and Git tags, with no npm publish or binary release step.
The first standalone release is calculated from conventional commits after the bootstrap revision
in the release config. [Extraction provenance](extraction.md) records the retained version baseline.

Moving from `session-marking@adc-vault` changes the marketplace registration, not the plugin's
machine-local configuration or binding state. Follow the [migration commands](../README.md#migrate-from-adc-vault) to verify the new installation
and remove only the old plugin registration. See [extraction provenance](extraction.md) for source history and
[the adapter contract](adapter-contract.md#compatibility) for compatibility guarantees.
