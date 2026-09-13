# Extraction provenance

Portable source was extracted from `plugins/session-marking/` at vault revision
[`bec281cdd6d57b15ea1162047f36751501440d4b`](https://github.com/AdCreative-ai/adcreative-obsidian-work-os/tree/bec281cdd6d57b15ea1162047f36751501440d4b/plugins/session-marking).
A fresh clone of that branch was filtered with `git filter-repo --subdirectory-filter
plugins/session-marking`; only that subtree's relevant history remains. The filtered baseline is
`da23da65c3a37e6c94d3a69b6bd7797154d9cd51` and contains nine commits. Commit identities changed
because tree paths and parents changed. Original authors, dates, and messages are preserved.

The extracted package starts at version 1.2.0. Its runtime (`src/` and
`scripts/session-marking.mjs`) is byte-identical to that source snapshot. Host adapter code stays
with its host. The repository's own marketplaces, release configuration, and architecture contract
are added after the filtered baseline; they are not claims about historical distribution.

Release Please starts its new repository history at the filtered baseline and retains
`session-marking-vX.Y.Z` tags. Historical changelog links continue to point to their original
repository; the extraction does not fabricate corresponding remote releases or tags.
