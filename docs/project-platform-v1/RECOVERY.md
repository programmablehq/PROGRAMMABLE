# Recovery and release controls

Project revisions, requirements, run steps, check evidence and deployment
receipts live in PostgreSQL. An ephemeral sandbox or worker is never the only
copy of a project. A new worker resumes through a signed grant and a fenced
lease; it does not infer completion from an interrupted HTTP response.

## Work and external effects

- Read-only model calls can fail without changing saved source. Invalid tool
  arguments and unsupported requirement edits return bounded feedback; the
  original requirements remain authoritative.
- A malformed provider decision gets at most one persisted retry using the
  configured escalation model, charged as another model step. Ordinary provider
  refusals are not treated as protocol errors. No rejected tool envelope is
  executed, and a second format failure ends the work unit.
- A file write uses the expected revision and its persisted idempotency receipt.
  A stale editor must reload or deliberately apply its change to the new revision.
- A sandbox reserves its allowance before creation. Cleanup is recorded; an
  unresolved cleanup continues to consume its reservation.
- A deployment submission with a missing response is looked up by its saved
  release identity. No second deployment is sent to guess what happened.
- Publication, pause and resume first persist one app control intent. Only the
  same intent may resume while its outcome is pending. The selected application
  capability stays inactive until the provider state has been confirmed and the
  data key, active release and control receipt can commit together.
- Control recovery uses the operations dispatcher after an expired lease or a
  failed provider response. Three automatic attempts are the maximum. Exhausted
  recovery remains visible; **Retry hosting action** retries the saved operation.
  A late worker cannot change the completed result of its successor.
- Scheduled callbacks reuse their persisted run ID. Unknown non-idempotent
  outcomes disable the job for review instead of duplicating its effect.

## Operator checks

Use the existing authenticated operations endpoint and deployment logs. Check
the saved owner, project, revision, release identity, lease and provider target
together. A successful health response from a preview is not proof that this
preview is the active production target. Verify that target separately.

Never resolve an uncertain action by deleting its receipt, rewriting a revision,
resetting an idempotency key, or issuing a transaction with a new nonce. The
contract launch path retains its existing source review and wallet authority.

## Deployment rollback

The schema is additive. Apply its reviewed SQL and runtime grants in a database
transaction before enabling the matching code. Retain the existing project
tables, source revisions, encrypted key versions and receipts during a code
rollback. Reapplying the SQL is supported; a transaction failure must roll back
the whole migration.

Keep the previous web/runtime artifacts available. Turning off
`CUSTOM_AI_PLATFORM_ENABLED` closes the new platform routes and dispatch. It
does not erase saved data or replace the separate legacy coin-chat flow. This
flag also stops new app data/connector calls, so an operator must account for
new-platform applications when choosing a rollback. Restore only a compatible
code/schema/keyring combination and verify ordinary authenticated access before
reenabling the platform.

This runbook describes implemented controls. Production rollback and recovery
acceptance still require evidence from the exact deployed release.
