# Platform database rollout

The additive schema is `schema-v1.sql`. The reviewed runtime role for the current
deployment is `custom_ai_runtime_v1`; it already serves the separate legacy AI
schema. Do not replace that login, change its password, or grant it schema-owner
rights as part of this migration.

Use `scripts/custom-ai/platform-database.mjs` from a clean pinned checkout:

```sh
node scripts/custom-ai/platform-database.mjs plan --runtime-role custom_ai_runtime_v1 --database EXACT_DATABASE --output /private/path/platform-plan.json
node scripts/custom-ai/platform-database.mjs dry-run --plan /private/path/platform-plan.json
node scripts/custom-ai/platform-database.mjs apply --plan /private/path/platform-plan.json --confirm-plan EXACT_PLAN_HASH
node scripts/custom-ai/platform-database.mjs verify --plan /private/path/platform-plan.json
```

Set `PROGRAMMABLE_MIGRATOR_DATABASE_URL` and
`PROGRAMMABLE_POSTGRES_SSL_CA_PEM` privately for database modes. They must not be
command-line arguments, repository files or logged output. Plan generation does
not connect to a database. The exact target database, source commit, schema
digest, role and table inventory are bound into the plan hash.

Dry-run applies the same DDL, grants and verification inside a rolled-back
transaction. Apply commits only after every table and privilege matches the
plan. Tenant tables require forced row security. History/evidence tables are
insert-only to the runtime role, and the role cannot truncate platform tables.
Operator routing tables contain identifiers and scheduling metadata only.

Keep the platform feature flag disabled until the matching worker, keyring,
hosting/sandbox credentials and ordinary-user staging acceptance are complete.
Applying the schema alone does not enable the product. Retain database recovery
access and the previous compatible code artifacts for the release rollback.
