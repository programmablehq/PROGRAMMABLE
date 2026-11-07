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

CREATE INDEX IF NOT EXISTS project_owner_updated_v1 ON programmable_projects_v1.projects(owner,updated_at DESC,id);
ALTER TABLE programmable_projects_v1.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_projects_v1.idempotency FORCE ROW LEVEL SECURITY;

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
END
$migration$;

REVOKE ALL ON ALL TABLES IN SCHEMA programmable_projects_v1 FROM PUBLIC;
