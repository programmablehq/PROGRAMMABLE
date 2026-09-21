---
description: Reference for existing Classic coins on Ethereum
---

# Classic on Ethereum

Classic is the fixed supply Ethereum launch model. This page describes its deployed contracts and existing coins. The website's coin builder uses Module Mode on Robinhood Chain.

## Supply and liquidity

A Classic launch creates one billion tokens with 18 decimals, initializes an ETH pool and locks the token supply in a one-sided Uniswap v4 position. The launch wallet receives the tokens it buys during the initial transaction. The token has no transfer tax, blacklist, rebase, later minting or separate creator allocation.

The original position has no liquidity removal path. This does not guarantee a future price or support from a trading service.

## Fees and rewards

Buy and sell fees are chosen separately from 1% to 10% in one-percentage-point steps. Programmable's 0.10% share is included. A 1% fee leaves 0.90% for creator rewards.

Rewards accrue in ETH and can be assigned to one wallet or split between two and five wallets. Each recipient claims its own share. Recipient changes apply to future earnings.

## Initial buy

The initial buy is at least 0.0006 ETH. Purchased tokens can remain unlocked, use a fixed lock, vest linearly or vest after a cliff. Lock and vesting periods run from one to 3,650 days and are fixed at launch.

## Contracts

| Contract | Ethereum address |
| --- | --- |
| Launcher | `0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770` |
| Hook | `0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC` |
| Reward vault factory | `0xF28967f9DFaC3Ca21384b59D6D75C8106b3eab2a` |
| Initial buy custody factory | `0xDe21b9c0Cc0AfDB9be20e8236113f066BB8C66f4` |
| Position recipient factory | `0x291a9ff1059d225d02B1659430804486404dB507` |

Use the deployment records in the product repository to verify code hashes and the release that applies to a coin.
