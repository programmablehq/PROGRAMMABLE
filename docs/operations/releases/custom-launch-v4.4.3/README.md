# Automatic native platform fees V2

This candidate adds an exact five-chain hook/vault kit. It is inactive until the
reviewed API and issuer configuration select the V2 capability. Local fork
evidence is not proof of production activation.

| Chain | Platform destination | Native currency |
| --- | --- | --- |
| Ethereum | Team wallet, 100% | ETH |
| Base | Team wallet, 100% | ETH |
| HyperEVM | Team wallet, 100% | HYPE |
| Elysium | Team wallet, 100% | HYPE |
| Robinhood | Existing router: 80% buyback reserve, 20% team | ETH |

Team wallet: `0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62`. The same policy applies
to the additional opening surcharge; creator fees remain separate. Purchased
V4 is delivered to the team wallet by the existing bounded worker. No burn.

Activation requires the additive V2 fee-profile database configuration, matching
API/issuer public policy and all five AI production contexts, existing runtime
release gates and a newly authorized Robinhood completion launch. The previous
one-launch financial authorization is consumed. Keep old release captures and
contract packages unchanged. Previously approved exact subjects retain their
valid signing window and original fee policy.

Legacy deployments cannot be redirected in place. Their fixed-recipient claims
need a separate collection/forwarding action; a new capability does not sweep
old liquidity, non-native fee assets, creator fees, or external exchange revenue.
