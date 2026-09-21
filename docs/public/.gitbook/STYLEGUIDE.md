# Documentation style

Write in plain, factual English. A page should help someone understand the product or complete one task. Use short connected paragraphs, descriptive headings and examples only when they make a rule clearer.

## Voice

Use everyday words. Avoid slogans, marketing claims, rhetorical contrasts, artificial urgency and filler. Do not use em dashes as sentence punctuation. Prefer sentence case headings and consistent product names: Programmable, Module Mode, Foundation and Custom Launch.

Write for the reader of the page. Creator guides explain what to enter, pay and expect. Developer references retain exact fields, units, permissions and error codes needed for integration. Do not repeat those details on product overviews.

## Structure and links

Keep the sidebar grouped by task: Launch, Developers and Reference. Do not add a thin overview page when an existing page covers the same topic.

Link to a destination once where it helps the next action. Keep general community and repository links on Official links. Use tables for comparisons and ordered lists for steps that must happen in sequence. Avoid long lists of release artifacts and duplicate reference links.

Keep historical URLs working when reorganizing pages. Full versioned API contracts can live in their existing machine-readable references; the human guide should explain when and how to use them.

## Facts

Do not infer availability from implemented code or a healthy endpoint. Distinguish API permission, request authorization, wallet execution, finality and indexing. Keep these distinctions where they affect the reader's next action, without repeating a warning on every page.

Read addresses, client versions and release limits from discovery. A changed catalog does not require rewriting general Module Mode pages. Do not promise that every ERC-20, hook or future module is supported.

Use percentages in product explanations and the exact units required by an API in technical references. Creator earnings, module rewards, platform revenue, liquidity deposits and gas are separate amounts.

## Credentials and verification

Never request API secrets, private keys, seed phrases or signatures in documentation, public issues or chat. Explain an error and the next useful action without blaming the reader.

The canonical source is `docs/public` in `programmablehq/PROGRAMMABLE`, on the `production` branch. Check the published GitBook content and navigation after synchronization. A merge or HTTP 200 alone does not prove that the new page is visible.
