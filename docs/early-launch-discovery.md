# Early launch visibility

Ethereum launches through both published Launch Stamp Router generations can appear in Explore before the finalized identity feed catches up. The website scans the latest 256 blocks, ending two blocks behind the lower of its two independent provider heads. It compares discovery logs, block hashes, source runtimes, successful receipts, stamp records and pool initialization.

These rows carry `confirmation: "confirming"` and `observationExpiresAt` in Unix milliseconds. They contain no canonical provenance. A refresh starts at most once per ten seconds per server instance; requests share in-flight work. Up to 32 recent candidates are checked with concurrency three. Previously checked receipts are reused only after both providers rediscover their exact block-bound events. Provider disagreement fails the observation. A cold observation read waits at most 750 ms; Next.js sustains the remaining discovery work after the response. Fresh observations can serve during a refresh, but are discarded on failure or expiry. The canonical catalogs remain available.

Explore removes observations after 30 seconds without renewed verification, including remembered browser results. The canonical record replaces an observation by chain and token address. Owner-hidden identities remain excluded. A direct Ethereum token link can show a small confirmation page which refreshes automatically; this does not grant trading or claim eligibility. The existing 64-confirmation canonical reader and finalized developer feed are unchanged.

Robinhood's existing receipt-confirmed Module Foundation display remains in place. This scanner does not change Robinhood's different custom-plan event formats or finality rules. External terminal badges remain controlled by each terminal's indexer.

Validation uses the public DNA receipt at Ethereum block 26170294, including the pool initialization and complete stamp group, and a replay with two independent providers at head 26170296. No launch transaction is sent for this display change.
