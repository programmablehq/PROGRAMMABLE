# Build a project in AI Chat

Open [AI Chat](/launch/custom-ai) and connect your existing wallet session. Check [live capabilities](/api/custom-ai/capabilities) on the same website: `projectPlatform.state` must be `enabled`. A deployment or preview can have different availability from the public website. The capability response describes configured features; each project still needs its own checks and publication result.

During a limited rollout, `projectPlatform.rollout` is `pilot` and access depends on your signed-in account. Other accounts keep their existing coin chats and saved work. A `general` rollout makes the workspace available to normal eligible accounts.

If access changes while a page is open, save your current work and reload the page to refresh the available workspace. Existing coin chats remain available when your account no longer has project access.

## Describe the result

Start in **Describe your idea**, or choose **Custom hook**, **Web app** or **Contract + app**. Contract starters use the network selected beside them, including Elysium. A starter fills the composer without starting work. Your first message creates and names a project. In an existing project, use **Message your project** to describe a change and include the rules that must stay in place. You can use ordinary German or English. Enter sends; Shift + Enter adds a line. The saved requirement list and **Technical plan** show what the chat understood. Answer an open question before treating that requirement as settled.

Choose a work mode before sending:

| Mode | What it does |
| --- | --- |
| **Build** | Changes the project and can run checks. |
| **Discuss** | Reads the project and records its requirements without editing source files. |
| **Check** | Tests the saved source and records results for that version. |
| **Publish** | Uses the publication and scheduled-task permissions already granted to the project. |

New projects start in Build mode. Discuss keeps source unchanged; switching to a new project does not carry an old discussion-only mode into it.

Work is saved as it runs. The chat shows the current action and completed steps; **Run details** expands usage and technical steps. Reloading reads the same saved run. **Retry saved message** recovers an interrupted first submission with the same project and request. **Stop** requests cancellation; wait for its saved result. A finished run and a verified project are separate states. Read the recorded checks and any remaining requirements in **Preview & run**.

**Your work** can be collapsed to give the chat and results more room. The project overview links the saved requirements, files and next action. **Continue from here** prepares a continuation from the same project after an interruption; it does not silently repeat the original request.

After successful work, the workspace opens the relevant requirements, files, app preview or contract review. On mobile, use **Chat** and **Result** to switch views. **Your work** opens the history.

## Edit files and keep earlier work

Open **Files** to inspect complete files or save a direct edit. Save or discard an open edit before switching projects. Compare versions to inspect the changed files; restoring an older version creates a new saved version. Concurrent edits produce a conflict instead of overwriting newer work.

Use **Import & export** for an exported project bundle or a repository at a fixed commit. Repository import requires an empty project. An authorized repository export creates a separate branch and draft pull request. It does not update the original branch automatically. Binary files and imported executable-file permissions are preserved.

**Your work** lists projects and earlier coin conversations together. Search their titles and open either kind of work. Switching away from a coin chat saves its draft first. **Coin chat options** opens its rename and archive controls. A saved general contract can be imported into a new project while its original chat remains available. See the [coin-chat guide](/developers/custom-ai-browser.md) for its controls.

## Connect an API or tool

Open **Connections** and add an HTTP API, OpenAPI document or remote MCP endpoint. Review the discovered actions and grant only the actions the project should use. Public APIs, API keys and OAuth authorization-code connections with PKCE are supported. Private values belong in the connection's credential fields, not in chat messages or source files.

Connections are bound to their owner and project. Changing an MCP tool list requires renewed review. Discovery alone does not grant execution rights, and a tool's description does not authorize a write. Revoke a connection to prevent subsequent calls. Remote MCP support covers reviewed tools; it does not grant server-initiated sampling, resource access or arbitrary access to your computer.

Signed webhooks can deliver deduplicated external events. An event that should affect a contract also needs its own reviewed mapping and authorized onchain action. An API response or game score alone does not prove a contract update occurred.

Webhook receipt storage is limited to 5,000 events and 32 MB per account across its connections. Exact retries reuse the saved receipt. Game intake allows 120 newly accepted signed events per account per UTC hour; invalid requests and exact retries do not consume that allowance.

Before building a game receiver, the chat uses `event.identity` to derive its binding ID from the authenticated project and the public game configuration. Use that exact ID in the receiver constructor. This read-only step does not register or deploy a receiver: the deployed code, issuer configuration, player signatures and wallet actions still require their own verification. Ordinary source revisions retain the same ID; a different project, owner or game policy receives a different ID.

## Current code and documentation

The project agent can read current npm metadata with `research.package` and public HTTPS documentation with `research.read`. Reads return their source and retrieval time; documentation also includes a content hash and bounded pagination. They use no account credentials, reject private endpoints and do not follow redirects or execute page content. A registry release is reference data, not proof of compatibility. The project still needs an exact dependency lock and checks.

Contract libraries remain pinned to the selected chain's current verified launch profile. A newer npm release does not replace those deployment bindings. Small editable source files and their hashes are supplied directly to the next project step. Saved source writes are not replayed as duplicate model decisions, and the latest canonical context and contract results remain available through longer work units.

## Check, preview and publish

Generated code runs in an isolated development sandbox with bounded resources and network access denied by default. Reviewed connections supply external API access. The sandbox lasts for development work; published applications use a separate hosting runtime.

`contract.verify` compiles the exact revision and runs its declared behavior checks in one tool step. It uses the same compiler, artifact binding and EVM checker as the individual tools. The independent `contract.audit` source review remains separate. A failed compilation or behavior check is reported as a failure, including in progress.

Contract checks can create genuine game-event and wallet-link signatures with fixed local test actors. These checks use public test identities inside the networkless EVM; they never need your wallet key or the game service's signing key. Production receiver configuration keeps the actual service issuer. Local signature results do not authorize a wallet action or establish a deployed game effect.

The hosting profile supports static sites, Node API handlers and Vite frontends. It does not run a Next.js application server. Applications can use project data, private connections and scheduled tasks. A multiuser application must implement its own visitor authentication and ownership checks.

**Preview apps after successful checks** is enabled by default. A successful build request creates and opens a preview only when the current app version has passing checks. Turn the option off before sending to create previews manually in **Preview & run**. Preview data is separate from live data. **Publish this version** remains a separate action: it promotes that exact release and attaches it to the project's live data. Changes to source need fresh checks. A missing hosting credential or failed provider operation remains visible; the presence of hosting configuration is not proof that a service is working.

After publication, verify the actual URL and expected behavior. Pause and resume apply to the saved application, and scheduled tasks have their own controls. An uncertain external operation stays pending for reconciliation instead of being repeated blindly. Pausing does not mean the provider has deleted every billable resource.

Coin launches keep their existing source review, launch preparation and wallet controls. A checked source package does not sign or send a transaction. Treat a launch as complete only after its transaction and resulting deployment are confirmed.

## Allowances and recovery

The chat reserves work before starting and reports its saved usage. It requests up to 20 units per work unit, bounded by the remaining hourly and daily account allowance. The server also enforces platform-wide and concurrent-work limits. Unused reservations are returned when the run settles.

If the work limit is reached, the completed files and checks stay saved. Continue from that project when an allowance is available. Keep the existing request while its outcome is unknown; reloading or reconnecting should read saved work, not create a second run. Never paste wallet keys or service credentials to resolve an error.

Capability fields and recorded project results describe different boundaries: workspace access, saved source, passing checks, a ready preview, a published release and confirmed runtime behavior. Check each boundary needed by your project before relying on it.
