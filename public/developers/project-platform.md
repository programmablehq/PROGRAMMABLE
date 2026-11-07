# Build a project in AI Chat

Open [AI Chat](/launch/custom-ai) and connect your existing wallet session. Check [live capabilities](/api/custom-ai/capabilities) on the same website: `projectPlatform.state` must be `enabled`. A deployment or preview can have different availability from the public website. The capability response describes configured features; each project still needs its own checks and publication result.

During a limited rollout, `projectPlatform.rollout` is `pilot` and access depends on your signed-in account. Other accounts keep their existing coin chats and saved work. A `general` rollout makes the workspace available to normal eligible accounts.

If access changes while a page is open, save your current work and reload the page to refresh the available workspace. **Saved coin chats** remains available when a project action reports that your account no longer has access.

## Describe the result

Create or select a project and use **Message your project** to describe what it should do. Include the rules that must stay in place when you ask for a change. You can use ordinary German or English. The saved requirement list and **Technical plan** show what the chat understood. Answer an open question before treating that requirement as settled.

Choose a work mode before sending:

| Mode | What it does |
| --- | --- |
| **Build & edit** | Changes the project and can run checks. |
| **Discuss & plan** | Reads the project and records its requirements without editing source files. |
| **Run checks** | Tests the saved source and records results for that version. |
| **Publish & run** | Uses the publication and scheduled-task permissions already granted to the project. |

Work is saved as it runs. Reloading reads the same saved run. If a run is interrupted, read its current status before sending another request. **Stop** requests cancellation; wait for its saved result. A finished run and a verified project are separate states. Read the recorded checks and any remaining requirements in **Preview & run**.

## Edit files and keep earlier work

Open **Files** to inspect complete files or save a direct edit. Save or discard an open edit before switching projects. Compare versions to inspect the changed files; restoring an older version creates a new saved version. Concurrent edits produce a conflict instead of overwriting newer work.

Use **Import & export** for an exported project bundle or a repository at a fixed commit. Repository import requires an empty project. An authorized repository export creates a separate branch and draft pull request. It does not update the original branch automatically. Binary files and imported executable-file permissions are preserved.

**Saved coin chats** opens earlier coin conversations. A saved general contract can be imported into a new project while its original chat remains available. See the [coin-chat guide](/developers/custom-ai-browser.md) for its controls.

## Connect an API or tool

Open **Connections** and add an HTTP API, OpenAPI document or remote MCP endpoint. Review the discovered actions and grant only the actions the project should use. Public APIs, API keys and OAuth authorization-code connections with PKCE are supported. Private values belong in the connection's credential fields, not in chat messages or source files.

Connections are bound to their owner and project. Changing an MCP tool list requires renewed review. Discovery alone does not grant execution rights, and a tool's description does not authorize a write. Revoke a connection to prevent subsequent calls. Remote MCP support covers reviewed tools; it does not grant server-initiated sampling, resource access or arbitrary access to your computer.

Signed webhooks can deliver deduplicated external events. An event that should affect a contract also needs its own reviewed mapping and authorized onchain action. An API response or game score alone does not prove a contract update occurred.

## Check, preview and publish

Generated code runs in an isolated development sandbox with bounded resources and network access denied by default. Reviewed connections supply external API access. The sandbox lasts for development work; published applications use a separate hosting runtime.

The hosting profile supports static sites, Node API handlers and Vite frontends. It does not run a Next.js application server. Applications can use project data, private connections and scheduled tasks. A multiuser application must implement its own visitor authentication and ownership checks.

Use **Preview & run** to inspect checks and create a preview from a verified version. Preview data is separate from live data. Publication promotes that exact release and attaches it to the project's live data. Changes to source need fresh checks. A missing hosting credential or failed provider operation remains visible; the presence of hosting configuration is not proof that a service is working.

After publication, verify the actual URL and expected behavior. Pause and resume apply to the saved application, and scheduled tasks have their own controls. An uncertain external operation stays pending for reconciliation instead of being repeated blindly. Pausing does not mean the provider has deleted every billable resource.

Coin launches keep their existing source review, launch preparation and wallet controls. A checked source package does not sign or send a transaction. Treat a launch as complete only after its transaction and resulting deployment are confirmed.

## Allowances and recovery

The chat reserves work before starting and reports its saved usage. It requests up to 20 units per work unit, bounded by the remaining hourly and daily account allowance. The server also enforces platform-wide and concurrent-work limits. Unused reservations are returned when the run settles.

If the work limit is reached, the completed files and checks stay saved. Continue from that project when an allowance is available. Keep the existing request while its outcome is unknown; reloading or reconnecting should read saved work, not create a second run. Never paste wallet keys or service credentials to resolve an error.

Capability fields and recorded project results describe different boundaries: workspace access, saved source, passing checks, a ready preview, a published release and confirmed runtime behavior. Check each boundary needed by your project before relying on it.
