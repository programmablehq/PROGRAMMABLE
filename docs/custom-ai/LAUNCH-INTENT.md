# Complete launch intent and candidate source revisions

`LaunchIntent` is the private, complete design. It is distinct from `RuleSpecV2`, whose requirements must all have an executable composed-module implementation. A design can therefore retain ten requirements and four open choices without pretending its six executable parts are the whole design.

Each requirement has a stable id, plain text, a behavior/constraint/decision kind, its exact user-message origin and an optional open question. Model proposals cannot assign checked, active or launch-ready states. Old saved designs retain their source hash and requirement ids with an explicit legacy origin; no user quote is invented during migration.

The planner returns all requirements. Replacing or removing a saved requirement uses an explicit edit with a quote from the latest user message. A selected rule restricts edits to its id. Missing or unauthorized edits retain the previous requirement in the next design and block code generation. A question retains the same canonical design and revision.

The server seals each design revision with SHA-256 and its parent revision. After the existing compiler and validators succeed, `CandidateRevision` binds the intent revision, exact source and artifact hashes, route, requirement ids and previous candidate revision. This is a source binding, not proof of arbitrary-code semantics, funded execution, deployment or public availability. Existing readiness and release checks still apply.

The API loads intent from account-owned job results, never from a browser-provided context object. Studio restore reads the latest context separately from an older checked draft when needed and coalesces a shared job id into one read. The UI and local cache retain open requirements across reload and previous-coin restoration. Keeping the previous rules restores that draft's bound intent.

These changes do not implement the general Custom Contract adapter or private multi-chat history. Those remain separate parts of the product plan. The selected chain, pair, wallet and current availability continue to be checked by the launch preparation path; the stored intent is not a current chain-readiness snapshot.
