# Project workspace

This document describes the release candidate behind `CUSTOM_AI_PLATFORM_ENABLED`. It is not evidence that the candidate is deployed or publicly available.

Start a project from AI Chat and describe the result you want in your own words. Each project keeps its requirements, source files, versions, connections and work history. Work already accepted by the server continues after the browser closes. Reopening the project reads its saved status.

The chat offers four modes:

- **Build & edit** can change the project and run checks.
- **Discuss & plan** reads the project and records requirements without changing source files.
- **Run checks** inspects and tests the saved source.
- **Publish & run** can use the publication and scheduled-task actions already granted to this project.

Open **Files** to inspect or edit complete files, compare versions, restore an earlier version as a new one, or export the project. A file edit is explicit. Save or discard it before changing projects. Concurrent changes produce a conflict instead of overwriting another version.

Open **Connections** to add an HTTP API, OpenAPI document or MCP endpoint. Choose the actions the project may use. Supply credentials in the private connection field. Review discovered MCP actions before granting them; discovery clears the old action selection. Revoking a connection prevents further calls. Editing permissions keeps credentials only when the endpoint and authentication configuration are unchanged.

Open **Preview & run** to inspect recorded checks and create an application preview from a checked version. Preview data is separate from live data. Publishing promotes a specific checked release. Stop and resume operate on the saved app; scheduled tasks also have their own pause controls. A task whose callback result is unknown remains marked for reconciliation.

Coin projects use the existing source review, launch preparation, admission and wallet controls. Saving a source package or passing its checks does not sign a transaction. General auxiliary contracts have a contract review view. Their compiled source and checks remain available without presenting them as a launched coin.

Open **Import & export** to import a public repository at a fixed commit, connect an owned private repository, import an exported project bundle or create a separate branch and draft pull request. Imports need an empty project. The original repository branch is not updated automatically. An interrupted export resumes its saved request.

**Saved coin chats** opens the existing chat library. A saved general contract can be imported into a new project from that view. The old chat remains available.

Supported application hosting is bounded to static files, Node API handlers and Vite builds. The current profile does not host a Next.js application server. Project data does not automatically provide visitor authentication; a multiuser app must implement and check that behavior. The interface distinguishes saved source, passing checks, a preview and a published release.
