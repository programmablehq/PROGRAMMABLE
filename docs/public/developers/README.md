---
description: Build with the launch APIs or index Programmable coins
---

# Developers

Choose the guide for the task you need to complete.

| Task | Guide |
| --- | --- |
| Launch your own contracts | [Custom Launch quickstart](custom-launch-quickstart.md) |
| Check request fields and errors | [Custom Launch API](custom-launch.md) |
| Develop a reusable module | [Build a module](module-mode.md) |
| Add coins to a terminal, wallet or explorer | [Index launches](indexing.md) |
| Find schemas, ABIs and client releases | [API reference](machine-readable.md) |

## Custom Launch access

Use a key from the [API-key manager](https://programmable.market/developers/api-keys). Preflight and creation need `custom-launch:create`; status reads need `custom-launch:read`. The key must also be bound to the intended chain and controller.

Store the secret as `PROGRAMMABLE_API_KEY` outside source control, logs and chat messages. The API key and CLI never sign or broadcast. The controller wallet reviews and signs the authorized transaction.

A key's permissions do not establish that a contract layout or source package is supported. Check the selected API's capabilities before building. Partner roots and subkeys use the scope, chain and history rules in `customLaunchApi.partnerCredentials`.

## Public reads

Launch indexing does not need a launch API key. Use the chain and token address as the coin's identity, and verify it against the correct source. Module Mode and Custom Launch use different records. Missing optional metadata or market data should not hide a verified coin.
