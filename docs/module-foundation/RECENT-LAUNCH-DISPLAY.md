# Confirmed launches in Explore

After a successful Module Mode receipt, the browser sends its chain, token and transaction hash to `POST /api/module-foundation/confirmed`. This is a lookup hint. It does not supply token metadata or authorize indexing.

The server loads the admitted source and independently checks the exact transaction, factory event, immutable metadata and pool state with both chain providers. It stores matching observations in the private `website-index/module-foundation/confirmed-v1.json` object. Failed verification leaves the normal background index unchanged.

Explore can show these receipt-confirmed rows before settlement finality. Their API rows carry `confirmation: "confirmed"`. They are presentation records only and are never used as trading, launch or module authority. Each distinct receipt block is checked against both providers with a shared 15-second read window. A conflicting block or unavailable provider omits the provisional row.

Canonical indexed identities always take precedence. Records expire after one hour, the store holds at most 64 identities, and updates use conditional writes to preserve concurrent launches. Owner-hidden identities stay hidden. Price feeds are not requested for provisional rows.

On Robinhood, a matching token and transaction in the finalized Foundation index completes the hint immediately. The server can then acknowledge an indexed launch even after its receipt block leaves the public providers' historical read window.

The browser deduplicates notifications, respects the server's retry interval and uses up to three attempts. Reopening a saved launch can retry after a temporary failure. The endpoint coalesces identical requests, caps concurrent verification and limits new verification jobs. Explore refreshes while visible using its shared market caches.

This reduces the delay after receipt confirmation. It does not make transaction mining or settlement finality instantaneous.
