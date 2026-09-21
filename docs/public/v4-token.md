---
description: V4 identity, liquidity and burns
---

# V4 token

V4 is Programmable's token on Robinhood Chain. It was created with one billion tokens and has no further minting. Identify it by its contract address.

| Detail | Value |
| --- | --- |
| Name and ticker | Programmable, V4 |
| Network | Robinhood Chain, chain ID `4663` |
| Contract | [`0xC60bA256B44334A0Cd2C7242E98B88f031abB006`](https://robinhoodchain.blockscout.com/token/0xC60bA256B44334A0Cd2C7242E98B88f031abB006) |
| Initial supply | 1,000,000,000 V4 |

## Liquidity and trading fees

The V4/ETH pool charges a **1% trading fee**, shared by liquidity providers according to their positions. Wallet-to-wallet transfers do not incur this pool fee.

Programmable's liquidity is held in a [locked position](https://robinhoodchain.blockscout.com/address/0x9f9424BbCCe8a865f70155fe40Fb22A103eBEc63), NFT `1708785`. The position can collect fees while its liquidity remains locked. It earns ETH on buys and V4 on sells.

## Buybacks and burns

Programmable allocates half of its platform fee revenue to buying and burning V4. The other half goes to the treasury. V4 collected from its liquidity fees is also burned. Creator fees and module rewards are excluded. [Fees and revenue](economics.md) explains the allocation.

Burns send V4 to `0x000000000000000000000000000000000000dEaD`. These tokens are excluded from circulation, while the contract's reported total supply remains one billion. Completed burns and their transactions are available on the [Dune dashboard](https://dune.com/programmablehq/analytics).

V4 does not give holders company ownership or a right to platform revenue. Buybacks and burns do not guarantee a price or return. This token is separate from Programmable's earlier Ethereum tokens.
