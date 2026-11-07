CREATE SCHEMA IF NOT EXISTS programmable_projects_v1;
REVOKE ALL ON SCHEMA programmable_projects_v1 FROM PUBLIC;

CREATE TABLE IF NOT EXISTS programmable_projects_v1.projects (
  owner text NOT NULL,
  id uuid NOT NULL,
  current_revision text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (owner,id)
);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.revisions (
  owner text NOT NULL,
  project_id uuid NOT NULL,
  id text NOT NULL,
  parent_id text,
  ordinal bigint NOT NULL CHECK (ordinal > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  requirements_hash text NOT NULL,
  files_hash text NOT NULL,
  dependencies_hash text NOT NULL,
  architecture_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner,project_id,id),
  UNIQUE (owner,project_id,ordinal),
  FOREIGN KEY (owner,project_id) REFERENCES programmable_projects_v1.projects(owner,id)
);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.idempotency (
  owner text NOT NULL,
  project_id uuid NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  revision_id text NOT NULL,
  PRIMARY KEY (owner,project_id,key),
  FOREIGN KEY (owner,project_id,revision_id) REFERENCES programmable_projects_v1.revisions(owner,project_id,id)
);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.artifacts (
  owner text NOT NULL,
  project_id uuid NOT NULL,
  id text NOT NULL,
  content bytea NOT NULL CHECK (octet_length(content) <= 4000000),
  media_type text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner,project_id,id),
  FOREIGN KEY (owner,project_id) REFERENCES programmable_projects_v1.projects(owner,id)
);
CREATE INDEX IF NOT EXISTS project_artifact_expiry_v1 ON programmable_projects_v1.artifacts(owner,expires_at);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.runs (
  owner text NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  request_key text NOT NULL,
  request_hash text NOT NULL,
  policy_hash text NOT NULL,
  revision_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('plan','build','test','deploy')),
  prompt text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','waiting_user','retryable','failed','cancelled','succeeded')),
  cursor integer NOT NULL DEFAULT 0 CHECK (cursor>=0),
  reserved_units integer NOT NULL CHECK (reserved_units>0),
  used_units integer NOT NULL DEFAULT 0 CHECK (used_units>=0 AND used_units<=reserved_units),
  reserved_hour bigint NOT NULL,
  reserved_day bigint NOT NULL,
  settled boolean NOT NULL DEFAULT false,
  lease_token text,
  lease_until timestamptz,
  worker_id text,
  summary text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (owner,project_id,id),
  UNIQUE (owner,project_id,request_key),
  FOREIGN KEY (owner,project_id,revision_id) REFERENCES programmable_projects_v1.revisions(owner,project_id,id)
);
CREATE INDEX IF NOT EXISTS project_run_owner_state_v1 ON programmable_projects_v1.runs(owner,status,created_at);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.run_steps (
  owner text NOT NULL,
  project_id uuid NOT NULL,
  run_id uuid NOT NULL,
  id text NOT NULL,
  cursor integer NOT NULL CHECK (cursor>=0),
  capability_id text NOT NULL,
  input_hash text NOT NULL,
  input jsonb NOT NULL,
  result jsonb,
  state text NOT NULL CHECK (state IN ('dispatching','completed','unknown')),
  effect text NOT NULL CHECK (effect IN ('read','write')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts>0 AND attempts<=3),
  lease_token text NOT NULL,
  PRIMARY KEY (owner,project_id,run_id,id),
  UNIQUE (owner,project_id,run_id,cursor),
  FOREIGN KEY (owner,project_id,run_id) REFERENCES programmable_projects_v1.runs(owner,project_id,id)
);

-- Private dispatcher routing metadata only. No prompts, files, tokens or results.
-- The dispatcher role receives this table, not access to tenant source tables.
CREATE TABLE IF NOT EXISTS programmable_projects_v1.dispatch_outbox (
  owner text NOT NULL,
  project_id uuid NOT NULL,
  run_id uuid NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  PRIMARY KEY(owner,project_id,run_id),
  FOREIGN KEY(owner,project_id,run_id) REFERENCES programmable_projects_v1.runs(owner,project_id,id)
);
CREATE INDEX IF NOT EXISTS project_dispatch_due_v1 ON programmable_projects_v1.dispatch_outbox(next_attempt_at);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.sandbox_jobs (
  owner text NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  revision_id text NOT NULL,
  provider_name text NOT NULL,
  command_hash text NOT NULL,
  state text NOT NULL CHECK(state IN ('reserved','active','cleaned','cleanup_pending')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  duration_ms integer,
  exit_code integer,
  PRIMARY KEY(owner,project_id,id),
  FOREIGN KEY(owner,project_id,revision_id) REFERENCES programmable_projects_v1.revisions(owner,project_id,id)
);
-- Private operator quota metadata. No source, environment variables or secrets.
CREATE TABLE IF NOT EXISTS programmable_projects_v1.sandbox_slots (
  owner text NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  provider_name text NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(owner,project_id,id) REFERENCES programmable_projects_v1.sandbox_jobs(owner,project_id,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.sandbox_usage (
  subject text NOT NULL,
  period bigint NOT NULL,
  used_ms bigint NOT NULL CHECK(used_ms>=0),
  PRIMARY KEY(subject,period)
);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.check_evidence (
  owner text NOT NULL,
  project_id uuid NOT NULL,
  id text NOT NULL,
  revision_id text NOT NULL,
  requirement_ids jsonb NOT NULL,
  requirements_hash text NOT NULL,
  command_hash text NOT NULL,
  passed boolean NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(owner,project_id,id),
  FOREIGN KEY(owner,project_id,revision_id) REFERENCES programmable_projects_v1.revisions(owner,project_id,id)
);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.connections (
  owner text NOT NULL, project_id uuid NOT NULL, id uuid NOT NULL,
  version text NOT NULL, manifest jsonb NOT NULL, allowed_actions jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('active','pending','revoked')),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  PRIMARY KEY(owner,project_id,id),
  FOREIGN KEY(owner,project_id) REFERENCES programmable_projects_v1.projects(owner,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.connection_secrets (
  owner text NOT NULL, project_id uuid NOT NULL, connection_id uuid NOT NULL,
  key_version text NOT NULL, ciphertext text NOT NULL, updated_at timestamptz NOT NULL,
  PRIMARY KEY(owner,project_id,connection_id),
  FOREIGN KEY(owner,project_id,connection_id) REFERENCES programmable_projects_v1.connections(owner,project_id,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.connector_calls (
  owner text NOT NULL, project_id uuid NOT NULL, connection_id uuid NOT NULL,
  request_key text NOT NULL, input_hash text NOT NULL, effect text NOT NULL CHECK(effect IN ('read','write')),
  state text NOT NULL CHECK(state IN ('pending','completed','unknown')), result jsonb,
  attempts integer NOT NULL DEFAULT 1 CHECK(attempts>=1 AND attempts<=3),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(owner,project_id,connection_id,request_key),
  FOREIGN KEY(owner,project_id,connection_id) REFERENCES programmable_projects_v1.connections(owner,project_id,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.oauth_states (
  owner text NOT NULL, project_id uuid NOT NULL, connection_id uuid NOT NULL,
  state_hash text NOT NULL, key_version text NOT NULL, ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false,
  PRIMARY KEY(owner,state_hash),
  FOREIGN KEY(owner,project_id,connection_id) REFERENCES programmable_projects_v1.connections(owner,project_id,id)
);
-- Private routing lookup used before webhook authentication; never exposed as a list.
CREATE TABLE IF NOT EXISTS programmable_projects_v1.webhook_routes (
  id uuid PRIMARY KEY, owner text NOT NULL, project_id uuid NOT NULL, connection_id uuid NOT NULL, version text NOT NULL,
  FOREIGN KEY(owner,project_id,connection_id) REFERENCES programmable_projects_v1.connections(owner,project_id,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.webhook_inbox (
  owner text NOT NULL, project_id uuid NOT NULL, connection_id uuid NOT NULL, event_id text NOT NULL,
  body_hash text NOT NULL, payload jsonb NOT NULL, received_at timestamptz NOT NULL,
  PRIMARY KEY(owner,project_id,connection_id,event_id),
  FOREIGN KEY(owner,project_id,connection_id) REFERENCES programmable_projects_v1.connections(owner,project_id,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_config (
  owner text NOT NULL, project_id uuid NOT NULL, data_version integer NOT NULL CHECK(data_version>0), active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(owner,project_id), FOREIGN KEY(owner,project_id) REFERENCES programmable_projects_v1.projects(owner,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_keys (
  owner text NOT NULL, project_id uuid NOT NULL, id uuid NOT NULL, data_version integer NOT NULL,
  secret_envelope text NOT NULL, active boolean NOT NULL DEFAULT true, data_namespace text NOT NULL DEFAULT 'production',
  PRIMARY KEY(owner,project_id,id), FOREIGN KEY(owner,project_id) REFERENCES programmable_projects_v1.app_config(owner,project_id)
);
-- Private token routing index; no secret values or application contents.
CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_key_index (
  token_hash text PRIMARY KEY, owner text NOT NULL, project_id uuid NOT NULL, key_id uuid NOT NULL,
  FOREIGN KEY(owner,project_id,key_id) REFERENCES programmable_projects_v1.app_keys(owner,project_id,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_items (
  owner text NOT NULL, project_id uuid NOT NULL, data_namespace text NOT NULL DEFAULT 'production', collection text NOT NULL, item_key text NOT NULL,
  value jsonb NOT NULL, version bigint NOT NULL CHECK(version>0), updated_at timestamptz NOT NULL, deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(owner,project_id,data_namespace,collection,item_key), FOREIGN KEY(owner,project_id) REFERENCES programmable_projects_v1.app_config(owner,project_id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_receipts (
  owner text NOT NULL, project_id uuid NOT NULL, data_namespace text NOT NULL DEFAULT 'production', request_key text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(owner,project_id,data_namespace,request_key), FOREIGN KEY(owner,project_id) REFERENCES programmable_projects_v1.app_config(owner,project_id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_usage (
  owner text NOT NULL, project_id uuid NOT NULL, day bigint NOT NULL, requests integer NOT NULL CHECK(requests>0),
  PRIMARY KEY(owner,project_id,day), FOREIGN KEY(owner,project_id) REFERENCES programmable_projects_v1.app_config(owner,project_id)
);
-- Cross-tenant resource admission contains routing metadata only.
CREATE TABLE IF NOT EXISTS programmable_projects_v1.hosting_slots (
  owner text NOT NULL, project_id uuid NOT NULL, provider_name text NOT NULL,
  PRIMARY KEY(owner,project_id), FOREIGN KEY(owner,project_id) REFERENCES programmable_projects_v1.projects(owner,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_hosts (
  owner text NOT NULL, project_id uuid NOT NULL, provider_id text NOT NULL, provider_name text NOT NULL, active_release uuid,
  PRIMARY KEY(owner,project_id), UNIQUE(provider_id), FOREIGN KEY(owner,project_id) REFERENCES programmable_projects_v1.projects(owner,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_releases (
  owner text NOT NULL, project_id uuid NOT NULL, id uuid NOT NULL, revision_id text NOT NULL,
  request_key text NOT NULL, request_hash text NOT NULL, artifact_hash text NOT NULL,
  mode text NOT NULL CHECK(mode IN ('preview','production')),
  state text NOT NULL CHECK(state IN ('queued','building','ready','published','stopped','failed','reconcile')),
  data_version integer NOT NULL, evidence jsonb NOT NULL, provider_id text, deployment_id text, url text,
  created_at timestamptz NOT NULL, observed_at timestamptz, artifact_id text,
  stage text NOT NULL DEFAULT 'pack', error_code text,
  PRIMARY KEY(owner,project_id,id), UNIQUE(owner,project_id,request_key),
  FOREIGN KEY(owner,project_id,revision_id) REFERENCES programmable_projects_v1.revisions(owner,project_id,id)
);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.release_queue (
  owner text NOT NULL, project_id uuid NOT NULL, release_id uuid NOT NULL, next_at timestamptz NOT NULL,
  lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY(owner,project_id,release_id), FOREIGN KEY(owner,project_id,release_id) REFERENCES programmable_projects_v1.app_releases(owner,project_id,id)
);
CREATE INDEX IF NOT EXISTS release_due_v1 ON programmable_projects_v1.release_queue(next_at);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_jobs (
  owner text NOT NULL, project_id uuid NOT NULL, id text NOT NULL, path text NOT NULL,
  interval_seconds integer NOT NULL CHECK(interval_seconds BETWEEN 60 AND 604800), idempotent boolean NOT NULL,
  body jsonb NOT NULL, enabled boolean NOT NULL, definition_hash text NOT NULL,
  PRIMARY KEY(owner,project_id,id), FOREIGN KEY(owner,project_id) REFERENCES programmable_projects_v1.projects(owner,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_job_runs (
  owner text NOT NULL, project_id uuid NOT NULL, id uuid NOT NULL, job_id text NOT NULL, release_id uuid NOT NULL,
  definition_hash text NOT NULL, state text NOT NULL CHECK(state IN ('pending','completed','reconcile')),
  attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL, finished_at timestamptz,
  PRIMARY KEY(owner,project_id,id), FOREIGN KEY(owner,project_id,job_id) REFERENCES programmable_projects_v1.app_jobs(owner,project_id,id)
);
-- Private dispatch metadata, never a payload or secret; the worker sets owner scope before reading the task.
CREATE TABLE IF NOT EXISTS programmable_projects_v1.app_job_queue (
  owner text NOT NULL, project_id uuid NOT NULL, job_id text NOT NULL, next_at timestamptz NOT NULL,
  run_id uuid, lease_token uuid, lease_until timestamptz,
  PRIMARY KEY(owner,project_id,job_id), FOREIGN KEY(owner,project_id,job_id) REFERENCES programmable_projects_v1.app_jobs(owner,project_id,id)
);
CREATE INDEX IF NOT EXISTS app_job_due_v1 ON programmable_projects_v1.app_job_queue(next_at);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.game_bindings (
  owner text NOT NULL, project_id uuid NOT NULL, id text NOT NULL, version text NOT NULL, definition jsonb NOT NULL, active boolean NOT NULL,
  PRIMARY KEY(owner,project_id,id), FOREIGN KEY(owner,project_id) REFERENCES programmable_projects_v1.projects(owner,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.game_wallets (
  owner text NOT NULL, project_id uuid NOT NULL, binding_id text NOT NULL, version text NOT NULL,
  player_id_hash text NOT NULL, player text NOT NULL, proof jsonb NOT NULL,
  PRIMARY KEY(owner,project_id,binding_id,version,player_id_hash), FOREIGN KEY(owner,project_id,binding_id) REFERENCES programmable_projects_v1.game_bindings(owner,project_id,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.game_events (
  owner text NOT NULL, project_id uuid NOT NULL, binding_id text NOT NULL, event_id text NOT NULL,
  binding_version text NOT NULL, binding_definition jsonb NOT NULL, payload_hash text NOT NULL, payload jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('received','prepared','submitted','confirmed','failed')),
  prepared_transaction jsonb, transaction_hash text, observation jsonb, created_at timestamptz NOT NULL,
  PRIMARY KEY(owner,project_id,binding_id,event_id), FOREIGN KEY(owner,project_id,binding_id) REFERENCES programmable_projects_v1.game_bindings(owner,project_id,id)
);
CREATE TABLE IF NOT EXISTS programmable_projects_v1.game_event_routes (
  binding_id text PRIMARY KEY, owner text NOT NULL, project_id uuid NOT NULL,
  FOREIGN KEY(owner,project_id,binding_id) REFERENCES programmable_projects_v1.game_bindings(owner,project_id,id)
);

CREATE TABLE IF NOT EXISTS programmable_projects_v1.repository_deliveries (
  owner text NOT NULL, project_id uuid NOT NULL, id uuid NOT NULL, request_key text NOT NULL, request_hash text NOT NULL,
  revision_id text NOT NULL, repository text NOT NULL, branch text NOT NULL,
  state text NOT NULL CHECK(state IN ('running','complete','reconcile')),
  base_ref text, base_sha text, tree_sha text, commit_sha text, url text, error_code text,
  created_at timestamptz NOT NULL, lease_token uuid, lease_until timestamptz, attempts integer NOT NULL,
  PRIMARY KEY(owner,project_id,id), UNIQUE(owner,project_id,request_key),
  FOREIGN KEY(owner,project_id,revision_id) REFERENCES programmable_projects_v1.revisions(owner,project_id,id)
);

CREATE INDEX IF NOT EXISTS project_owner_updated_v1 ON programmable_projects_v1.projects(owner,updated_at DESC,id);
ALTER TABLE programmable_projects_v1.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.idempotency FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.runs FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.run_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.sandbox_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.sandbox_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.check_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.check_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.connections FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.connection_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.connection_secrets FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.connector_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.connector_calls FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.oauth_states FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.webhook_inbox FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_config FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_items FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_hosts FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_releases FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.app_job_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.game_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.game_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.game_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.game_wallets FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.game_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.game_events FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.repository_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.repository_deliveries FORCE ROW LEVEL SECURITY;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='projects' AND policyname='project_owner_v1') THEN
    CREATE POLICY project_owner_v1 ON programmable_projects_v1.projects
      USING (owner=current_setting('programmable.project_owner',true))
      WITH CHECK (owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='revisions' AND policyname='revision_owner_v1') THEN
    CREATE POLICY revision_owner_v1 ON programmable_projects_v1.revisions
      USING (owner=current_setting('programmable.project_owner',true))
      WITH CHECK (owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='idempotency' AND policyname='idempotency_owner_v1') THEN
    CREATE POLICY idempotency_owner_v1 ON programmable_projects_v1.idempotency
      USING (owner=current_setting('programmable.project_owner',true))
      WITH CHECK (owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='artifacts' AND policyname='artifact_owner_v1') THEN
    CREATE POLICY artifact_owner_v1 ON programmable_projects_v1.artifacts
      USING (owner=current_setting('programmable.project_owner',true))
      WITH CHECK (owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='runs' AND policyname='run_owner_v1') THEN
    CREATE POLICY run_owner_v1 ON programmable_projects_v1.runs
      USING (owner=current_setting('programmable.project_owner',true))
      WITH CHECK (owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='run_steps' AND policyname='run_step_owner_v1') THEN
    CREATE POLICY run_step_owner_v1 ON programmable_projects_v1.run_steps
      USING (owner=current_setting('programmable.project_owner',true))
      WITH CHECK (owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='sandbox_jobs' AND policyname='sandbox_job_owner_v1') THEN
    CREATE POLICY sandbox_job_owner_v1 ON programmable_projects_v1.sandbox_jobs
      USING (owner=current_setting('programmable.project_owner',true))
      WITH CHECK (owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='check_evidence' AND policyname='check_evidence_owner_v1') THEN
    CREATE POLICY check_evidence_owner_v1 ON programmable_projects_v1.check_evidence
      USING (owner=current_setting('programmable.project_owner',true))
      WITH CHECK (owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='connections' AND policyname='connection_owner_v1') THEN
    CREATE POLICY connection_owner_v1 ON programmable_projects_v1.connections USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
    CREATE POLICY connection_secret_owner_v1 ON programmable_projects_v1.connection_secrets USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
    CREATE POLICY connector_call_owner_v1 ON programmable_projects_v1.connector_calls USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='oauth_states' AND policyname='oauth_state_owner_v1') THEN
    CREATE POLICY oauth_state_owner_v1 ON programmable_projects_v1.oauth_states USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='webhook_inbox' AND policyname='webhook_inbox_owner_v1') THEN
    CREATE POLICY webhook_inbox_owner_v1 ON programmable_projects_v1.webhook_inbox USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='app_config' AND policyname='app_config_owner_v1') THEN
    CREATE POLICY app_config_owner_v1 ON programmable_projects_v1.app_config USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
    CREATE POLICY app_key_owner_v1 ON programmable_projects_v1.app_keys USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
    CREATE POLICY app_item_owner_v1 ON programmable_projects_v1.app_items USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
    CREATE POLICY app_receipt_owner_v1 ON programmable_projects_v1.app_receipts USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
    CREATE POLICY app_usage_owner_v1 ON programmable_projects_v1.app_usage USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='app_hosts' AND policyname='app_host_owner_v1') THEN
    CREATE POLICY app_host_owner_v1 ON programmable_projects_v1.app_hosts USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
    CREATE POLICY app_release_owner_v1 ON programmable_projects_v1.app_releases USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='app_jobs' AND policyname='app_job_owner_v1') THEN
    CREATE POLICY app_job_owner_v1 ON programmable_projects_v1.app_jobs USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
    CREATE POLICY app_job_run_owner_v1 ON programmable_projects_v1.app_job_runs USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='game_bindings' AND policyname='game_binding_owner_v1') THEN
    CREATE POLICY game_binding_owner_v1 ON programmable_projects_v1.game_bindings USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
    CREATE POLICY game_wallet_owner_v1 ON programmable_projects_v1.game_wallets USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
    CREATE POLICY game_event_owner_v1 ON programmable_projects_v1.game_events USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='programmable_projects_v1' AND tablename='repository_deliveries' AND policyname='repository_delivery_owner_v1') THEN
    CREATE POLICY repository_delivery_owner_v1 ON programmable_projects_v1.repository_deliveries USING(owner=current_setting('programmable.project_owner',true)) WITH CHECK(owner=current_setting('programmable.project_owner',true));
  END IF;
END
$migration$;

REVOKE ALL ON ALL TABLES IN SCHEMA programmable_projects_v1 FROM PUBLIC;
