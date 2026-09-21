---
description: What launch checks establish and what remains to verify
---

# Verification and risk

A source check, simulation and confirmed transaction answer different questions. Use the result relevant to the decision you are making.

| Check | What it establishes |
| --- | --- |
| Source and build | The submitted source and compiler inputs match the verified artifacts |
| Simulation | The exact transaction can execute in the tested state |
| Finality | The transaction has reached the chain confirmation level required by its launch source |
| Launch record | The token came from the recorded Programmable launcher or Router |
| Market data | The price, liquidity or activity observed by that provider |

Changed source, settings or transaction bytes may need fresh checks. Simulation does not cover every future contract interaction. A valid launch record does not guarantee liquidity, sellability or terminal support.

## Wallet authority

An API key allows specific API requests. It cannot sign for a wallet. The controller reviews the authorized transaction's network, destination, value and effects before signing.

## Security review

The public Programmable contracts have not undergone an external audit or public security contest. Internal review, tests and reproducible builds do not replace an independent audit. A launch stamp is a record of origin, not a security endorsement.

Report vulnerabilities through the affected repository's private security reporting channel. Keep credentials, signatures and unpublished exploit details out of public issues.
