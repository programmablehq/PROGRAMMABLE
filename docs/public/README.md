---
cover: .gitbook/assets/programmable-warm-night-v3.gif
coverY: 0
---

# Programmable

Programmable is a platform for launching tokens and custom projects on Uniswap v4. It provides a coin builder, launch APIs and public launch records that other apps can index. The website's coin builder runs on Robinhood Chain.

## Two ways to launch

| Launch path | What you do |
| --- | --- |
| [Module Mode](models/module-mode.md) | Set up a coin on the website and choose compatible modules. No coding is needed. |
| [Custom Launch](models/custom.md) | Build a project with your own token, hook or supporting contracts and prepare its launch through the API. |

Modules are reusable pieces of contract logic. You choose the available building blocks and their settings before launching. A custom project can define its own behavior, including how fees or other pool actions work.

In both paths, your wallet confirms the transactions. The public launch record identifies the project's contracts. Websites, explorers and trading terminals can use that record to discover the project.

## Fees and V4

Programmable earns platform fees from trades covered by its fee rules. Creators can set their own fees separately. [Fees and revenue](economics.md) explains the rates and how platform revenue is used, including V4 buybacks and burns.

## Development

We are adding more modules and working with teams building their own contracts and hooks. New modules expand what people can configure in the builder. Existing coins keep the module versions chosen at launch.

Developers integrating launches or connecting a trading terminal can start with the [developer guides](developers/README.md).
