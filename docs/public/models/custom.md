---
description: Launch a token and hook project with your own source code
---

# Custom hooks

Custom Launch is for projects that need their own token, hook or supporting contracts. A Uniswap v4 hook is a contract that runs at specified points in a pool operation, such as before or after a swap. Its code defines the behavior.

## Prepare the project

Choose the API profile for your network and contract layout before building. On Robinhood Chain, separate token and hook contracts use V4; a contract that implements both roles uses MultiRole V2. Each profile has its own source, funding and verification requirements.

The API checks your exact source package and deployment plan. A supported layout does not mean every implementation can be accepted automatically. The response identifies missing evidence or an unsupported requirement.

Follow the [Custom Launch quickstart](../developers/custom-launch-quickstart.md) to package, check and submit a project.

## Confirm the launch

An API key grants access to preparation and status requests. It cannot sign for your wallet. When the API authorizes a transaction, the controller wallet reviews and signs it. Track the transaction through finality before treating the launch as complete.

If a request times out, retry the same bytes with the same idempotency key. Changed source or configuration requires a new request.

## Fees and liquidity

Robinhood Native20 charges **0.20% for Programmable** per successful buy or sell. Creator and pool fees are separate. A creator fee of 0% produces no creator earnings from those trades.

An ordinary pool needs a funded liquidity position. Initializing a pool does not add liquidity. Projects with their own reserve or settlement model must implement it and provide the evidence required by the selected API.

[Fees and revenue](../economics.md) explains the fee models. A launch stamp records where the project came from; it does not establish liquidity, trading support or an external audit.
