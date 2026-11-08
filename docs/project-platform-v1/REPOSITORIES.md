# Importing and delivering source

Repository import resolves a GitHub reference once, records its full commit and tree IDs, and validates every imported file against its Git blob hash. Imported files are project data. They do not grant tools or permissions, and installation scripts run only through the existing sandbox.

The initial GitHub profile supports up to 128 files, 512 KB per file and 3.6 MB total. It requires a complete tree and refuses symbolic links and submodules. Private configuration such as `.env`, `.npmrc`, `.ssh` and `node_modules` is excluded and listed in provenance. Inline credentials detected in source block import. An account can retain at most 100 projects.

Import into an empty project. The existing file/history store preserves the resulting revision and source provenance. An import retry returns its original receipt, even after subsequent edits. JSON project bundles can also be imported; requirements and files are preserved, while a new project starts with no inherited verification or external permissions.

Public repositories can be read without connecting an account. Private reads and writes use a project-owned GitHub connection with the generated repository-specific manifest. Read and write actions are granted separately. The current GitHub REST API version is 2026-03-10. The HTTP adapter allows larger, bounded blob transfers only for this controlled repository path; its general default remains unchanged.

GitHub delivery exports an exact saved revision to a separate `programmable/…` branch. It verifies each uploaded blob and the created tree, creates a commit with a stable source reference, and opens a draft pull request when requested. It does not update or merge the default branch. Files, including executable bits from import provenance, are delivered as a complete snapshot for review.

Deliveries retain leases, phase identifiers and receipts. An accepted branch with a lost response is discovered by its exact ref and commit before further work. A changed or conflicting ref stops the export. GitHub write permissions and rate limits still apply; unknown results remain visible for reconciliation.

The operator's GitHub login is not an application credential for user projects. The live reference test uses a newly created private fixture repository, an encrypted fixture connection, a separate branch, and a draft PR; it verifies the original branch and then removes or archives only that fixture. Normal users connect their own account or token in the private connection UI.
