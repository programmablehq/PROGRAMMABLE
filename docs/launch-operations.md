# Launch overview

Open `/admin/launch-operations` with an authorized Programmable admin wallet. The page combines the existing review queue with website indexes, finalized custom launch feeds and recent confirmed module receipts on Ethereum and Robinhood. Refresh runs once per minute while the page is visible. No notification or background automation is created.

**Needs review** contains applications awaiting an operator decision. The review target is 24 hours; overdue applications remain open. **Waiting for team** includes information requests, requested changes and approved applications that have not started. **Needs checking** highlights started applications without an observed completion after 15 minutes and published or confirmed launches without an observed website index entry. This is a diagnostic threshold, not a signing deadline or proof of failure.

Use **Open review** to open the exact application. **Check status** reads its saved technical status, or checks indexing evidence for a known coin. An Ethereum module receipt without an index entry can be checked against the supported stamp contracts at a shared finalized block on two providers. A provider error is reported as an unavailable observation, never a missing stamp. Native Robinhood module provenance is valid without a Router stamp field.

The overview cannot sign, approve, relaunch, change a review deadline or write to the index. Existing review and launch authorization remain separate. An approved application still has 24 hours from approval to launch.

## Coverage

- The review service returns its latest 100 applications. Replaced applications do not count as current work. A finalized launch is correlated by chain and exact request ID or request hash, including up to 128 requests explicitly bound to the same review. A successful replan therefore completes its original application. Wallets and tickers never establish this link.
- Saved status from the current bound request distinguishes a prepared launch waiting for the team from an unsigned request on a retired release. The latter needs owner-authenticated replanning. Replanning does not extend approval; an expired approval needs a new review decision. Neither a stored status nor an approval is proof of finalization: completion still requires the canonical finalized feed.
- Website index counts use complete canonical catalogs, independent of market cap, images or trading volume. Intentional discovery exclusions do not become missing-index alerts.
- Finalized Robinhood feed traversal stops at 20 pages. Remaining pages make coverage partial. Ethereum uses the existing bounded finalized metadata reader.
- Recent module receipts cover the last hour and the existing 64-record storage bound. Unsubmitted wallet drafts and transactions that have not reached a recorded service are not visible.
- Each source read is bounded. A failed source remains unavailable; it does not become an empty successful result. Successful observations are shared for 30 seconds; partial source failures retry after 5 seconds.
- External trading terminal badges and routing availability are not inferred from a website index entry.
