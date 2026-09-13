# Session marking

For changes to responsibilities, interfaces, dependencies, execution/storage, or failure behavior,
read [the architecture guide](docs/architecture/README.md). When changing adapters or invocation,
read [the adapter contract](docs/adapter-contract.md); preserve its public CLI and schema compatibility.

Run `npm run verify` for portable implementation or distribution changes. Run
`python3 .architecture/check.py` for architecture changes. The shared checker is synchronized
through the owner procedure in [its provenance](.architecture/SOURCE.md).

Host selection and projection belong to adapters. Keep runtime code independent of host layouts;
use temporary configuration and state directories in tests. Release instructions are maintained in
[the release guide](docs/release.md).
