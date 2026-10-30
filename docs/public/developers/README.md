# Developers

Use the guide for your task and network: Ethereum Mainnet (`1`), Robinhood Chain (`4663`), Base (`8453`) or HyperEVM (`999`). Base and HyperEVM support Custom Launch; Module Mode remains on Ethereum and Robinhood.

| Task | Guide |
| --- | --- |
| Launch your own contracts | [Custom Launch quickstart](custom-launch-quickstart.md) |
| Launch on Base or HyperEVM | [Base](base-custom-launch.md) · [HyperEVM](hyperevm-custom-launch.md) |
| Check request fields and errors | [Custom Launch API](custom-launch.md) |
| Add coins to a terminal, wallet or explorer | [Index launches](indexing.md) |
| Find schemas, ABIs and client releases | [API reference](machine-readable.md) |

## Access

Custom Launch uses an API key for preparation and status requests. Your wallet signs the prepared transactions. Check the current capabilities for your network and project before building; key permissions and operation availability are separate.

Launch indexing does not need a launch API key. Use the chain and token address as the coin's identity and verify it against the correct launch source. Missing optional metadata or market data should not hide a verified coin.
