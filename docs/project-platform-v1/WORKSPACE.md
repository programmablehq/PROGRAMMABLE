# Project workspace

This document describes the release candidate behind `CUSTOM_AI_PLATFORM_ENABLED`. It is not evidence that the candidate is deployed or publicly available.

Describe the result you want in the AI Chat message field. Your first message creates a project and gives it a title. Each project keeps its requirements, source files, versions, connections and work history. An interrupted first submission can be retried from the saved message without creating a second project. Work already accepted by the server continues after the browser closes. Reopening the project reads its saved status.

The chat shows the work currently being performed and the steps already saved. **Run details** expands technical steps and usage. After successful work, the workspace opens the relevant result: requirements, files, app preview or contract review. On a small screen, use **Chat** and **Result** to switch views. Enter sends a message; Shift + Enter adds a line.

Recognizable credentials are rejected before a chat run, source revision or
artifact is stored. Private values belong in Connections. Check logs and model
observations redact credential values. This is a safeguard for recognizable
formats and named credential fields, not a guarantee that arbitrary text can
always be identified as secret.

Combined applications and contracts keep one complete requirement list, with
`architecture.requirementScopes.contract` and `.application` assigning each
requirement to one or both components. Both components must supply their own
passing evidence. A work unit allows at most two automatic source repairs for
an unresolved failed check before asking for review; a successful check clears
that check's repair failure.

The chat offers four modes:

- **Build & edit** can change the project and run checks.
- **Discuss & plan** reads the project and records requirements without changing source files.
- **Run checks** inspects and tests the saved source.
- **Publish & run** can use the publication and scheduled-task actions already granted to this project.

Open **Files** to inspect or edit complete files, compare versions, restore an earlier version as a new one, or export the project. A file edit is explicit. Save or discard it before changing projects. Concurrent changes produce a conflict instead of overwriting another version.

Open **Connections** to add an HTTP API, OpenAPI document or MCP endpoint. Choose the actions the project may use. Supply credentials in the private connection field. Review discovered MCP actions before granting them; discovery clears the old action selection. Revoking a connection prevents further calls. Editing permissions keeps credentials only when the endpoint and authentication configuration are unchanged.

**Preview apps after successful checks** is enabled by default. After a successful build request, the workspace creates and opens a preview only when the current app version has passing checks. Turn this option off before sending to create previews manually. **Preview & run** shows the recorded checks and preview controls. Preview data is separate from live data. Publishing remains a separate action that promotes a specific checked release. Stop and resume operate on the saved app; scheduled tasks also have their own pause controls. A task whose callback result is unknown remains marked for reconciliation.

Coin projects use the existing source review, launch preparation, admission and wallet controls. Saving a source package or passing its checks does not sign a transaction. General auxiliary contracts have a contract review view. Their compiled source and checks remain available without presenting them as a launched coin.

Open **Import & export** to import a public repository at a fixed commit, connect an owned private repository, import an exported project bundle or create a separate branch and draft pull request. Imports need an empty project. The original repository branch is not updated automatically. An interrupted export resumes its saved request.

**Your work** lists projects and saved coin chats together. Search by title and open either kind of work from the same history. Switching away from a coin chat saves its draft first. **Coin chat options** opens its existing rename and archive controls. A saved general contract can be imported into a new project from that view. The old chat remains available.

Supported application hosting is bounded to static files, Node API handlers and Vite builds. The current profile does not host a Next.js application server. Project data does not automatically provide visitor authentication; a multiuser app must implement and check that behavior. The interface distinguishes saved source, passing checks, a preview and a published release.
