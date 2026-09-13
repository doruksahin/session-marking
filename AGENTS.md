# Session marking

Start with [README.md](README.md) for newcomer navigation. Load the guide for the current request:

| Request | Read |
| --- | --- |
| Install, update, remove, or migrate an installation | [Installation](docs/installation.md) |
| Run a command, explain session identity or output, or diagnose a CLI error | [CLI](docs/cli.md) |
| Change enabled destinations or the local directory | [Configuration](docs/configuration.md) |
| Set up the vault integration | [Vault integration](docs/integrations/adc-vault.md) |
| Implement or change a host adapter | [Adapter contract](docs/adapter-contract.md) |
| Find the owning runtime module or change architecture | [Architecture](docs/architecture/README.md) |
| Publish a release | [Release guide](docs/release.md) |

For changes to responsibilities, interfaces, dependencies, execution/storage, or failure behavior,
read [the architecture guide](docs/architecture/README.md). When changing adapters or invocation,
read [the adapter contract](docs/adapter-contract.md); preserve its public CLI and schema compatibility.

Run `npm run verify` for portable implementation or distribution changes. Run
`python3 .architecture/check.py` for architecture changes. The shared checker is synchronized
through the owner procedure in [its provenance](.architecture/SOURCE.md).

Core selection belongs to the plugin; host validation and projection belong to adapters. Keep runtime
code independent of host layouts; use temporary configuration and state directories in tests. Keep command details in the CLI guide,
settings in the configuration guide, and adapter obligations in the adapter contract; link to the
owning guide from entry points instead of repeating its reference material.
