import "server-only";

import { X509Certificate } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { handlePostgresPoolErrors } from "../postgres-pool-errors";

import {
  canonicalizeJson,
} from "./canonical-json";
import type { Sha256Digest } from "./hashing";
import {
  PostgresProjectionTargetAtomicStoreV1,
  validateWebsiteProjectionRecordV1,
  type ProjectionTargetPostgresClientV1,
  type ProjectionTargetPostgresPoolV1,
  type ProjectionTargetPostgresQueryResultV1,
} from "./postgres-store";
import {
  createProjectionTargetReferenceHandlerV1,
  type ProjectionTargetLaneConfigurationV1,
  type ProjectionTargetReferenceHandlerV1,
} from "./protocol";
import {
  createEd25519ProjectionWorkloadCredentialVerifierV1,
} from "./workload-credential";
import {
  PostgresRegistryCustomLaunchPublicStoreV1,
} from "../custom-launch/registry-public-store-v1";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const SUPABASE_POOLER_HOST = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u;
const SUPABASE_PROJECT_REF = /^[a-z]{20}$/u;

export interface WebsiteProjectionTargetV1 {
  readonly handler: ProjectionTargetReferenceHandlerV1;
  readonly store: PostgresProjectionTargetAtomicStoreV1;
  readonly registryCustomPublicStore: PostgresRegistryCustomLaunchPublicStoreV1;
  readonly assertProductionReadiness: () => Promise<void>;
}

export interface WebsiteRegistryCustomPublicReadTargetV1 {
  readonly store: PostgresRegistryCustomLaunchPublicStoreV1;
  readonly assertProductionReadiness: () => Promise<void>;
}

export interface ProjectionTargetSecurityAttestationRowV1
extends Record<string, unknown> {
  runtime_role: string;
  session_role: string;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  schema_usage: boolean;
  schema_create: boolean;
  projections_select: boolean;
  projections_insert: boolean;
  projections_mutate: boolean;
  credentials_select: boolean;
  credentials_insert: boolean;
  credentials_mutate: boolean;
  registry_custom_select: boolean;
  registry_custom_insert: boolean;
  registry_custom_update: boolean;
  registry_custom_forbidden_mutate: boolean;
  projections_rls: boolean;
  projections_force_rls: boolean;
  credentials_rls: boolean;
  credentials_force_rls: boolean;
  registry_custom_rls: boolean;
  registry_custom_force_rls: boolean;
  expected_policies: boolean;
  provider_roles_excluded: boolean;
  ssl: boolean;
  ssl_version: string | null;
  ssl_cipher: string | null;
  ssl_bits: number | null;
}

export interface GmgnAccountGateSecurityAttestationRowV1
extends Record<string, unknown> {
  runtime_role: string;
  session_role: string;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  schema_usage: boolean;
  schema_create: boolean;
  gmgn_gate_select: boolean;
  gmgn_gate_update: boolean;
  gmgn_gate_forbidden_mutate: boolean;
  gmgn_history_insert: boolean;
  gmgn_history_delete: boolean;
  gmgn_history_prune_columns: boolean;
  gmgn_history_forbidden_access: boolean;
  gmgn_gate_rls: boolean;
  gmgn_gate_force_rls: boolean;
  gmgn_history_rls: boolean;
  gmgn_history_force_rls: boolean;
  gmgn_gate_singleton: boolean;
  expected_policies: boolean;
  provider_roles_excluded: boolean;
  ssl: boolean;
  ssl_version: string | null;
  ssl_cipher: string | null;
  ssl_bits: number | null;
}

export interface GmgnAccountGateMultiflightSecurityAttestationRowV1
extends Record<string, unknown> {
  runtime_role: string;
  session_role: string;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  schema_usage: boolean;
  schema_create: boolean;
  gmgn_leases_select: boolean;
  gmgn_leases_insert: boolean;
  gmgn_leases_delete: boolean;
  gmgn_leases_forbidden_access: boolean;
  gmgn_leases_rls: boolean;
  gmgn_leases_force_rls: boolean;
  expected_policies: boolean;
  provider_roles_excluded: boolean;
  ssl: boolean;
  ssl_version: string | null;
  ssl_cipher: string | null;
  ssl_bits: number | null;
}

export interface ExploreMarketCapAuthoritySecurityAttestationRowV1
extends Record<string, unknown> {
  runtime_role: string;
  session_role: string;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  schema_usage: boolean;
  schema_create: boolean;
  heads_select: boolean;
  heads_insert: boolean;
  heads_delete: boolean;
  heads_update: boolean;
  heads_forbidden_access: boolean;
  generations_select: boolean;
  generations_insert: boolean;
  generations_delete: boolean;
  generations_forbidden_access: boolean;
  heads_rls: boolean;
  heads_force_rls: boolean;
  generations_rls: boolean;
  generations_force_rls: boolean;
  expected_policies: boolean;
  provider_roles_excluded: boolean;
  ssl: boolean;
  ssl_version: string | null;
  ssl_cipher: string | null;
  ssl_bits: number | null;
}

export interface VerifiedPostgresTlsConfigurationV1 {
  readonly connectionString: string;
  readonly servername: string;
  readonly ca: string;
  readonly rejectUnauthorized: true;
}

let productionTarget: WebsiteProjectionTargetV1 | null = null;
let productionRegistryCustomPublicReadTarget:
WebsiteRegistryCustomPublicReadTargetV1 | null = null;

export function getProductionWebsiteRegistryCustomPublicReadTargetV1():
WebsiteRegistryCustomPublicReadTargetV1 {
  if (productionRegistryCustomPublicReadTarget !== null) {
    return productionRegistryCustomPublicReadTarget;
  }
  const expectedDatabaseRole = environmentId(
    "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE",
  );
  const pool = createProductionProjectionTargetPostgresPoolV1(
    environmentValue("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL"),
    environmentPem(
      "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM",
      "CERTIFICATE",
    ),
    expectedDatabaseRole,
  );
  productionRegistryCustomPublicReadTarget = Object.freeze({
    store: new PostgresRegistryCustomLaunchPublicStoreV1(pool),
    assertProductionReadiness: () => pool.assertProductionReadiness(),
  });
  return productionRegistryCustomPublicReadTarget;
}

export function getProductionWebsiteProjectionTargetV1(): WebsiteProjectionTargetV1 {
  if (productionTarget !== null) return productionTarget;

  const audience = environmentId(
    "PROGRAMMABLE_WEBSITE_PROJECTION_AUDIENCE",
  );
  const entitlementTargetBindingHash = environmentDigest(
    "PROGRAMMABLE_WEBSITE_ENTITLEMENT_TARGET_BINDING_HASH",
  );
  const customLaunchTargetBindingHash = environmentDigest(
    "PROGRAMMABLE_WEBSITE_CUSTOM_LAUNCH_TARGET_BINDING_HASH",
  );
  const expectedDatabaseRole = environmentId(
    "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE",
  );
  const pool = createProductionProjectionTargetPostgresPoolV1(
    environmentValue("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL"),
    environmentPem(
      "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM",
      "CERTIFICATE",
    ),
    expectedDatabaseRole,
  );
  productionTarget = createWebsiteProjectionTargetV1({
    pool,
    lanes: Object.freeze([
      Object.freeze({
        lane: "website.entitlement" as const,
        audience,
        targetBindingHash: entitlementTargetBindingHash,
      }),
      Object.freeze({
        lane: "website.custom-launched" as const,
        audience,
        targetBindingHash: customLaunchTargetBindingHash,
      }),
    ]),
    workloadJwt: Object.freeze({
      issuer: environmentId("PROGRAMMABLE_PROJECTION_WORKLOAD_ISSUER"),
      subject: environmentId("PROGRAMMABLE_PROJECTION_WORKLOAD_SUBJECT"),
      audience,
      keyId: environmentId("PROGRAMMABLE_PROJECTION_WORKLOAD_KEY_ID"),
      publicKeyPem: environmentPem(
        "PROGRAMMABLE_PROJECTION_WORKLOAD_PUBLIC_KEY_PEM",
      ),
    }),
    assertProductionReadiness: () => pool.assertProductionReadiness(),
  });
  return productionTarget;
}

export function createWebsiteProjectionTargetV1(input: Readonly<{
  pool: ProjectionTargetPostgresPoolV1;
  lanes: readonly ProjectionTargetLaneConfigurationV1[];
  workloadJwt: Readonly<{
    issuer: string;
    subject: string;
    audience: string;
    keyId: string;
    publicKeyPem: string;
  }>;
  assertProductionReadiness?: () => Promise<void>;
  now?: () => Date;
}>): WebsiteProjectionTargetV1 {
  const lanes = input.lanes.map((lane) => Object.freeze({ ...lane }));
  if (
    lanes.length !== 2
    || lanes[0]?.lane !== "website.entitlement"
    || lanes[1]?.lane !== "website.custom-launched"
    || lanes.some((lane) => lane.audience !== input.workloadJwt.audience)
  ) {
    throw new TypeError("website projection target lanes are invalid");
  }
  const targetBindings = Object.freeze(Object.fromEntries(
    lanes.map((lane) => [lane.lane, lane.targetBindingHash]),
  ));
  const credentialVerifier =
    createEd25519ProjectionWorkloadCredentialVerifierV1({
      ...input.workloadJwt,
      targetBindings,
      now: input.now,
    });
  const store = new PostgresProjectionTargetAtomicStoreV1(input.pool);
  const registryCustomPublicStore =
    new PostgresRegistryCustomLaunchPublicStoreV1(input.pool);
  const handler = createProjectionTargetReferenceHandlerV1({
    lanes,
    credentialVerifier,
    store,
    validateStoredRecordSemantics: validateWebsiteProjectionRecordV1,
    now: input.now,
  });
  if (
    input.assertProductionReadiness !== undefined
    && typeof input.assertProductionReadiness !== "function"
  ) throw new TypeError("website projection readiness attestor is invalid");
  return Object.freeze({
    handler,
    store,
    registryCustomPublicStore,
    assertProductionReadiness:
      input.assertProductionReadiness ?? (async () => {}),
  });
}

export async function handleProductionWebsiteProjectionTargetRequestV1(
  request: Request,
): Promise<Response> {
  try {
    const target = getProductionWebsiteProjectionTargetV1();
    await target.assertProductionReadiness();
    return await target.handler.handle(request);
  } catch {
    return new Response(canonicalizeJson({
      schemaVersion: "programmable.projection-target-error.v1",
      code: "target_unavailable",
    }), {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }
}

export function createProductionProjectionTargetPostgresPoolV1(
  connectionString: string,
  caPem: string,
  expectedRuntimeRole: string,
): ProductionProjectionTargetPostgresPoolV1 {
  const tls = verifiedPostgresTlsConfigurationV1(connectionString, caPem);
  if (!SAFE_ID.test(expectedRuntimeRole)) {
    throw new TypeError("website projection database role is invalid");
  }
  assertProductionDatabaseLoginRoleV1(tls.connectionString, expectedRuntimeRole);
  const pool = new Pool({
    connectionString: tls.connectionString,
    ssl: {
      ca: tls.ca,
      rejectUnauthorized: tls.rejectUnauthorized,
      servername: tls.servername,
    },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
    application_name: "programmable-website-projection-target-v1",
  });
  handlePostgresPoolErrors(pool);
  return new NodePostgresProjectionTargetPoolV1(pool, expectedRuntimeRole);
}

export function assertProductionDatabaseLoginRoleV1(
  connectionString: string,
  expectedRuntimeRole: string,
): void {
  let url: URL;
  let loginRole: string;
  try {
    url = new URL(connectionString);
    loginRole = decodeURIComponent(url.username);
  } catch {
    throw new TypeError("website projection database login role is invalid");
  }
  if (loginRole === expectedRuntimeRole) return;
  const projectRef = loginRole.slice(expectedRuntimeRole.length + 1);
  if (
    !loginRole.startsWith(`${expectedRuntimeRole}.`)
    || !SUPABASE_PROJECT_REF.test(projectRef)
    || !SUPABASE_POOLER_HOST.test(url.hostname.toLowerCase())
    || (url.port !== "5432" && url.port !== "6543")
  ) throw new TypeError("website projection database login role is invalid");
}

export function verifiedPostgresTlsConfigurationV1(
  connectionString: string,
  caPem: string,
): Readonly<VerifiedPostgresTlsConfigurationV1> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new TypeError("website projection database URL is invalid");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || url.username === ""
    || url.hostname === ""
    || url.hash !== ""
    || [...url.searchParams.keys()].some((key) =>
      /^ssl/iu.test(key)
      || ["options", "role", "session_authorization"].includes(key.toLowerCase()))
  ) {
    throw new TypeError("website projection database URL is invalid");
  }
  if (typeof caPem !== "string" || caPem.length > 131_072) {
    throw new TypeError("website projection database CA is invalid");
  }
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(caPem);
  } catch {
    throw new TypeError("website projection database CA is invalid");
  }
  const now = Date.now();
  if (
    !certificate.ca
    || Date.parse(certificate.validFrom) > now
    || Date.parse(certificate.validTo) <= now
  ) throw new TypeError("website projection database CA is invalid");
  return Object.freeze({
    connectionString,
    servername: url.hostname,
    ca: caPem,
    rejectUnauthorized: true as const,
  });
}

export interface ProductionProjectionTargetPostgresPoolV1
extends ProjectionTargetPostgresPoolV1 {
  assertProductionReadiness(): Promise<void>;
  assertGmgnAccountGateReadiness(): Promise<void>;
  assertGmgnAccountGateMultiflightReadiness(): Promise<void>;
  assertExploreMarketCapAuthorityReadiness(): Promise<void>;
}

class NodePostgresProjectionTargetPoolV1
implements ProductionProjectionTargetPostgresPoolV1 {
  readonly #pool: Pool;
  readonly #expectedRuntimeRole: string;
  #readiness: Promise<void> | null = null;
  #readinessAttestedAtMs = 0;
  #gmgnReadiness: Promise<void> | null = null;
  #gmgnReadinessAttestedAtMs = 0;
  #gmgnMultiflightReadiness: Promise<void> | null = null;
  #gmgnMultiflightReadinessAttestedAtMs = 0;
  #exploreMarketCapAuthorityReadiness: Promise<void> | null = null;
  #exploreMarketCapAuthorityReadinessAttestedAtMs = 0;

  constructor(pool: Pool, expectedRuntimeRole: string) {
    this.#pool = pool;
    this.#expectedRuntimeRole = expectedRuntimeRole;
  }

  async assertProductionReadiness(): Promise<void> {
    if (
      this.#readinessAttestedAtMs > 0
      && Date.now() - this.#readinessAttestedAtMs < 30_000
    ) return;
    this.#readiness ??= this.#performReadinessAttestation()
      .then(() => {
        this.#readinessAttestedAtMs = Date.now();
      });
    try {
      await this.#readiness;
    } catch (error) {
      this.#readinessAttestedAtMs = 0;
      throw error;
    } finally {
      this.#readiness = null;
    }
  }

  async assertGmgnAccountGateReadiness(): Promise<void> {
    if (
      this.#gmgnReadinessAttestedAtMs > 0
      && Date.now() - this.#gmgnReadinessAttestedAtMs < 30_000
    ) return;
    this.#gmgnReadiness ??= this.#performGmgnAccountGateReadinessAttestation()
      .then(() => {
        this.#gmgnReadinessAttestedAtMs = Date.now();
      });
    try {
      await this.#gmgnReadiness;
    } catch (error) {
      this.#gmgnReadinessAttestedAtMs = 0;
      throw error;
    } finally {
      this.#gmgnReadiness = null;
    }
  }

  async assertGmgnAccountGateMultiflightReadiness(): Promise<void> {
    if (
      this.#gmgnMultiflightReadinessAttestedAtMs > 0
      && Date.now() - this.#gmgnMultiflightReadinessAttestedAtMs < 30_000
    ) return;
    this.#gmgnMultiflightReadiness ??=
      this.#performGmgnAccountGateMultiflightReadinessAttestation()
        .then(() => {
          this.#gmgnMultiflightReadinessAttestedAtMs = Date.now();
        });
    try {
      await this.#gmgnMultiflightReadiness;
    } catch (error) {
      this.#gmgnMultiflightReadinessAttestedAtMs = 0;
      throw error;
    } finally {
      this.#gmgnMultiflightReadiness = null;
    }
  }

  async assertExploreMarketCapAuthorityReadiness(): Promise<void> {
    if (
      this.#exploreMarketCapAuthorityReadinessAttestedAtMs > 0 &&
      Date.now() - this.#exploreMarketCapAuthorityReadinessAttestedAtMs < 30_000
    ) return;
    this.#exploreMarketCapAuthorityReadiness ??=
      this.#performExploreMarketCapAuthorityReadinessAttestation()
        .then(() => {
          this.#exploreMarketCapAuthorityReadinessAttestedAtMs = Date.now();
        });
    try {
      await this.#exploreMarketCapAuthorityReadiness;
    } catch (error) {
      this.#exploreMarketCapAuthorityReadinessAttestedAtMs = 0;
      throw error;
    } finally {
      this.#exploreMarketCapAuthorityReadiness = null;
    }
  }

  async #performReadinessAttestation(): Promise<void> {
    const client = await this.#pool.connect();
    try {
      const result = await client.query<ProjectionTargetSecurityAttestationRowV1>(`
        SELECT current_user::text AS runtime_role,
               session_user::text AS session_role,
               role.rolsuper, role.rolcreaterole, role.rolcreatedb,
               role.rolreplication, role.rolbypassrls,
               has_schema_privilege(current_user,
                 'programmable_website_projection_v1', 'USAGE') AS schema_usage,
               has_schema_privilege(current_user,
                 'programmable_website_projection_v1', 'CREATE') AS schema_create,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.projection_records',
                 'SELECT') AS projections_select,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.projection_records',
                 'INSERT') AS projections_insert,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.projection_records',
                 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS projections_mutate,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.credential_uses',
                 'SELECT') AS credentials_select,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.credential_uses',
                 'INSERT') AS credentials_insert,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.credential_uses',
                 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS credentials_mutate,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.registry_custom_launch_records',
                 'SELECT') AS registry_custom_select,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.registry_custom_launch_records',
                 'INSERT') AS registry_custom_insert,
               (
                 has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'lifecycle_generation', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'lifecycle_state', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'lifecycle_binding_hash', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'observed_at', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'canonical_materialization', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'canonical_public_record', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'record_binding_hash', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'launch_security_binding_hash', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'launching_wallet_namespace', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'launching_wallet_value', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'updated_at', 'UPDATE')
               ) AS registry_custom_update,
               (
                 has_table_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'DELETE,TRUNCATE,REFERENCES,TRIGGER')
                 OR has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'project_id', 'UPDATE')
                 OR has_column_privilege(current_user,
                   'programmable_website_projection_v1.registry_custom_launch_records',
                   'launch_id', 'UPDATE')
               ) AS registry_custom_forbidden_mutate,
               projections.relrowsecurity AS projections_rls,
               projections.relforcerowsecurity AS projections_force_rls,
               credentials.relrowsecurity AS credentials_rls,
               credentials.relforcerowsecurity AS credentials_force_rls,
               registry_custom.relrowsecurity AS registry_custom_rls,
               registry_custom.relforcerowsecurity AS registry_custom_force_rls,
               (
                 SELECT count(*) = 7
                    AND bool_and(
                      policies.roles = ARRAY['programmable_website_projection_runtime']::name[]
                    )
                    AND string_agg(
                      policies.policyname || ':' || policies.cmd,
                      ',' ORDER BY policies.policyname
                    ) = 'credential_uses_runtime_insert:INSERT,credential_uses_runtime_select:SELECT,projection_records_runtime_insert:INSERT,projection_records_runtime_select:SELECT,registry_custom_launch_records_runtime_insert:INSERT,registry_custom_launch_records_runtime_select:SELECT,registry_custom_launch_records_runtime_update:UPDATE'
                   FROM pg_policies AS policies
                  WHERE policies.schemaname = 'programmable_website_projection_v1'
                    AND policies.tablename IN (
                      'projection_records', 'credential_uses',
                      'registry_custom_launch_records'
                    )
               ) AS expected_policies,
               NOT EXISTS (
                 SELECT 1
                   FROM pg_roles AS provider_role
                  WHERE provider_role.rolname IN ('anon', 'authenticated', 'service_role')
                    AND (
                      has_schema_privilege(provider_role.rolname,
                        'programmable_website_projection_v1', 'USAGE,CREATE')
                      OR has_table_privilege(provider_role.rolname,
                        'programmable_website_projection_v1.projection_records',
                        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                      OR has_table_privilege(provider_role.rolname,
                        'programmable_website_projection_v1.credential_uses',
                        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                      OR has_table_privilege(provider_role.rolname,
                        'programmable_website_projection_v1.registry_custom_launch_records',
                        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    )
               ) AS provider_roles_excluded,
               COALESCE(ssl.ssl, false) AS ssl,
               ssl.version AS ssl_version,
               ssl.cipher AS ssl_cipher,
               ssl.bits AS ssl_bits
          FROM pg_roles AS role
          JOIN pg_namespace AS schema
            ON schema.nspname = 'programmable_website_projection_v1'
          JOIN pg_class AS projections
            ON projections.relnamespace = schema.oid
           AND projections.relname = 'projection_records'
          JOIN pg_class AS credentials
            ON credentials.relnamespace = schema.oid
           AND credentials.relname = 'credential_uses'
          JOIN pg_class AS registry_custom
            ON registry_custom.relnamespace = schema.oid
           AND registry_custom.relname = 'registry_custom_launch_records'
          LEFT JOIN pg_stat_ssl AS ssl ON ssl.pid = pg_backend_pid()
         WHERE role.rolname = current_user
           AND pg_get_userbyid(schema.nspowner) <> current_user
           AND pg_get_userbyid(projections.relowner) <> current_user
           AND pg_get_userbyid(credentials.relowner) <> current_user
           AND pg_get_userbyid(registry_custom.relowner) <> current_user
      `);
      const value = result.rows[0];
      if (result.rows.length !== 1 || value === undefined) {
        throw new TypeError("website projection database attestation failed");
      }
      assertProjectionTargetSecurityAttestationV1(
        value,
        this.#expectedRuntimeRole,
      );
    } finally {
      client.release();
    }
  }

  async #performGmgnAccountGateReadinessAttestation(): Promise<void> {
    const client = await this.#pool.connect();
    try {
      const result = await client.query<GmgnAccountGateSecurityAttestationRowV1>(`
        SELECT current_user::text AS runtime_role,
               session_user::text AS session_role,
               role.rolsuper, role.rolcreaterole, role.rolcreatedb,
               role.rolreplication, role.rolbypassrls,
               has_schema_privilege(current_user,
                 'programmable_website_projection_v1', 'USAGE') AS schema_usage,
               has_schema_privilege(current_user,
                 'programmable_website_projection_v1', 'CREATE') AS schema_create,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.gmgn_account_gate_v1',
                 'SELECT') AS gmgn_gate_select,
               (
                 has_column_privilege(current_user,
                   'programmable_website_projection_v1.gmgn_account_gate_v1',
                   'generation', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.gmgn_account_gate_v1',
                   'next_slot_at', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.gmgn_account_gate_v1',
                   'blocked_until', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.gmgn_account_gate_v1',
                   'lease_holder', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.gmgn_account_gate_v1',
                   'lease_until', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.gmgn_account_gate_v1',
                   'updated_at', 'UPDATE')
               ) AS gmgn_gate_update,
               (
                 has_table_privilege(current_user,
                   'programmable_website_projection_v1.gmgn_account_gate_v1',
                   'INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                 OR has_column_privilege(current_user,
                   'programmable_website_projection_v1.gmgn_account_gate_v1',
                   'gate_id', 'UPDATE')
               ) AS gmgn_gate_forbidden_mutate,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
                 'INSERT') AS gmgn_history_insert,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
                 'DELETE') AS gmgn_history_delete,
               (
                 SELECT count(*) = 2
                    AND string_agg(privilege.column_name, ','
                      ORDER BY privilege.column_name) = 'gate_id,generation'
                   FROM information_schema.column_privileges AS privilege
                  WHERE privilege.table_schema =
                    'programmable_website_projection_v1'
                    AND privilege.table_name =
                      'gmgn_account_gate_decisions_v1'
                    AND privilege.grantee = current_user
                    AND privilege.privilege_type = 'SELECT'
               ) AS gmgn_history_prune_columns,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
                 'SELECT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
                 AS gmgn_history_forbidden_access,
               gmgn_gate.relrowsecurity AS gmgn_gate_rls,
               gmgn_gate.relforcerowsecurity AS gmgn_gate_force_rls,
               gmgn_history.relrowsecurity AS gmgn_history_rls,
               gmgn_history.relforcerowsecurity AS gmgn_history_force_rls,
               (
                 SELECT count(*) = 1
                    AND min(gate_id) = 'gmgn-openapi-v1'
                    AND min(generation) >= 0
                   FROM programmable_website_projection_v1.gmgn_account_gate_v1
               ) AS gmgn_gate_singleton,
               (
                 SELECT count(*) = 5
                    AND bool_and(
                      policies.roles = ARRAY['programmable_website_projection_runtime']::name[]
                    )
                    AND string_agg(
                      policies.policyname || ':' || policies.cmd,
                      ',' ORDER BY policies.policyname
                    ) = 'gmgn_account_gate_decisions_v1_runtime_insert:INSERT,gmgn_account_gate_decisions_v1_runtime_prune:DELETE,gmgn_account_gate_decisions_v1_runtime_prune_select:SELECT,gmgn_account_gate_v1_runtime_select:SELECT,gmgn_account_gate_v1_runtime_update:UPDATE'
                   FROM pg_policies AS policies
                  WHERE policies.schemaname = 'programmable_website_projection_v1'
                    AND policies.tablename IN (
                      'gmgn_account_gate_v1',
                      'gmgn_account_gate_decisions_v1'
                    )
               ) AS expected_policies,
               NOT EXISTS (
                 SELECT 1
                   FROM pg_roles AS provider_role
                  WHERE provider_role.rolname IN ('anon', 'authenticated', 'service_role')
                    AND (
                      has_table_privilege(provider_role.rolname,
                        'programmable_website_projection_v1.gmgn_account_gate_v1',
                        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                      OR has_table_privilege(provider_role.rolname,
                        'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
                        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    )
               ) AS provider_roles_excluded,
               COALESCE(ssl.ssl, false) AS ssl,
               ssl.version AS ssl_version,
               ssl.cipher AS ssl_cipher,
               ssl.bits AS ssl_bits
          FROM pg_roles AS role
          JOIN pg_namespace AS schema
            ON schema.nspname = 'programmable_website_projection_v1'
          JOIN pg_class AS gmgn_gate
            ON gmgn_gate.relnamespace = schema.oid
           AND gmgn_gate.relname = 'gmgn_account_gate_v1'
          JOIN pg_class AS gmgn_history
            ON gmgn_history.relnamespace = schema.oid
           AND gmgn_history.relname = 'gmgn_account_gate_decisions_v1'
          LEFT JOIN pg_stat_ssl AS ssl ON ssl.pid = pg_backend_pid()
         WHERE role.rolname = current_user
           AND pg_get_userbyid(schema.nspowner) <> current_user
           AND pg_get_userbyid(gmgn_gate.relowner) <> current_user
           AND pg_get_userbyid(gmgn_history.relowner) <> current_user
      `);
      const value = result.rows[0];
      if (result.rows.length !== 1 || value === undefined) {
        throw new TypeError("GMGN account gate database attestation failed");
      }
      assertGmgnAccountGateSecurityAttestationV1(
        value,
        this.#expectedRuntimeRole,
      );
    } finally {
      client.release();
    }
  }

  async #performGmgnAccountGateMultiflightReadinessAttestation(): Promise<void> {
    const client = await this.#pool.connect();
    try {
      const result = await client.query<
      GmgnAccountGateMultiflightSecurityAttestationRowV1>(`
        SELECT current_user::text AS runtime_role,
               session_user::text AS session_role,
               role.rolsuper, role.rolcreaterole, role.rolcreatedb,
               role.rolreplication, role.rolbypassrls,
               has_schema_privilege(current_user,
                 'programmable_website_projection_v1', 'USAGE') AS schema_usage,
               has_schema_privilege(current_user,
                 'programmable_website_projection_v1', 'CREATE') AS schema_create,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.gmgn_account_gate_leases_v1',
                 'SELECT') AS gmgn_leases_select,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.gmgn_account_gate_leases_v1',
                 'INSERT') AS gmgn_leases_insert,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.gmgn_account_gate_leases_v1',
                 'DELETE') AS gmgn_leases_delete,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.gmgn_account_gate_leases_v1',
                 'UPDATE,TRUNCATE,REFERENCES,TRIGGER')
                 AS gmgn_leases_forbidden_access,
               gmgn_leases.relrowsecurity AS gmgn_leases_rls,
               gmgn_leases.relforcerowsecurity AS gmgn_leases_force_rls,
               (
                 SELECT count(*) = 3
                    AND bool_and(
                      policies.roles = ARRAY['programmable_website_projection_runtime']::name[]
                    )
                    AND string_agg(
                      policies.policyname || ':' || policies.cmd,
                      ',' ORDER BY policies.policyname
                    ) = 'gmgn_account_gate_leases_v1_runtime_delete:DELETE,gmgn_account_gate_leases_v1_runtime_insert:INSERT,gmgn_account_gate_leases_v1_runtime_select:SELECT'
                   FROM pg_policies AS policies
                  WHERE policies.schemaname = 'programmable_website_projection_v1'
                    AND policies.tablename = 'gmgn_account_gate_leases_v1'
               ) AS expected_policies,
               NOT EXISTS (
                 SELECT 1
                   FROM pg_roles AS provider_role
                  WHERE provider_role.rolname IN ('anon', 'authenticated', 'service_role')
                    AND has_table_privilege(provider_role.rolname,
                      'programmable_website_projection_v1.gmgn_account_gate_leases_v1',
                      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               ) AS provider_roles_excluded,
               COALESCE(ssl.ssl, false) AS ssl,
               ssl.version AS ssl_version,
               ssl.cipher AS ssl_cipher,
               ssl.bits AS ssl_bits
          FROM pg_roles AS role
          JOIN pg_namespace AS schema
            ON schema.nspname = 'programmable_website_projection_v1'
          JOIN pg_class AS gmgn_leases
            ON gmgn_leases.relnamespace = schema.oid
           AND gmgn_leases.relname = 'gmgn_account_gate_leases_v1'
          LEFT JOIN pg_stat_ssl AS ssl ON ssl.pid = pg_backend_pid()
         WHERE role.rolname = current_user
           AND pg_get_userbyid(schema.nspowner) <> current_user
           AND pg_get_userbyid(gmgn_leases.relowner) <> current_user
      `);
      const value = result.rows[0];
      if (result.rows.length !== 1 || value === undefined) {
        throw new TypeError(
          "GMGN account gate multiflight database attestation failed",
        );
      }
      assertGmgnAccountGateMultiflightSecurityAttestationV1(
        value,
        this.#expectedRuntimeRole,
      );
    } finally {
      client.release();
    }
  }

  async #performExploreMarketCapAuthorityReadinessAttestation(): Promise<void> {
    const client = await this.#pool.connect();
    try {
      const result = await client.query<
      ExploreMarketCapAuthoritySecurityAttestationRowV1>(`
        SELECT current_user::text AS runtime_role,
               session_user::text AS session_role,
               role.rolsuper, role.rolcreaterole, role.rolcreatedb,
               role.rolreplication, role.rolbypassrls,
               has_schema_privilege(current_user,
                 'programmable_website_projection_v1', 'USAGE') AS schema_usage,
               has_schema_privilege(current_user,
                 'programmable_website_projection_v1', 'CREATE') AS schema_create,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                 'SELECT') AS heads_select,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                 'INSERT') AS heads_insert,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                 'DELETE') AS heads_delete,
               (
                 has_column_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                   'current_generation', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                   'lease_generation', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                   'lease_holder', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                   'lease_until', 'UPDATE')
                 AND has_column_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                   'updated_at', 'UPDATE')
               ) AS heads_update,
               (
                 has_table_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                   'UPDATE,TRUNCATE,REFERENCES,TRIGGER')
                 OR has_column_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                   'authority_key', 'UPDATE')
                 OR has_column_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                   'input_commitment', 'UPDATE')
                 OR has_column_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                   'direction', 'UPDATE')
                 OR has_any_column_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                   'REFERENCES')
               ) AS heads_forbidden_access,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.explore_market_cap_authority_generations_v1',
                 'SELECT') AS generations_select,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.explore_market_cap_authority_generations_v1',
                 'INSERT') AS generations_insert,
               has_table_privilege(current_user,
                 'programmable_website_projection_v1.explore_market_cap_authority_generations_v1',
                 'DELETE') AS generations_delete,
               (
                 has_table_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_generations_v1',
                   'UPDATE,TRUNCATE,REFERENCES,TRIGGER')
                 OR has_any_column_privilege(current_user,
                   'programmable_website_projection_v1.explore_market_cap_authority_generations_v1',
                   'UPDATE,REFERENCES')
               ) AS generations_forbidden_access,
               heads.relrowsecurity AS heads_rls,
               heads.relforcerowsecurity AS heads_force_rls,
               generations.relrowsecurity AS generations_rls,
               generations.relforcerowsecurity AS generations_force_rls,
               (
                 SELECT count(*) = 7
                    AND bool_and(
                      policies.roles = ARRAY['programmable_website_projection_runtime']::name[]
                    )
                    AND string_agg(
                      policies.policyname || ':' || policies.cmd,
                      ',' ORDER BY policies.policyname
                    ) = 'explore_market_cap_authority_generations_v1_runtime_delete:DELETE,explore_market_cap_authority_generations_v1_runtime_insert:INSERT,explore_market_cap_authority_generations_v1_runtime_select:SELECT,explore_market_cap_authority_heads_v1_runtime_delete:DELETE,explore_market_cap_authority_heads_v1_runtime_insert:INSERT,explore_market_cap_authority_heads_v1_runtime_select:SELECT,explore_market_cap_authority_heads_v1_runtime_update:UPDATE'
                   FROM pg_policies AS policies
                  WHERE policies.schemaname = 'programmable_website_projection_v1'
                    AND policies.tablename IN (
                      'explore_market_cap_authority_heads_v1',
                      'explore_market_cap_authority_generations_v1'
                    )
               ) AS expected_policies,
               NOT EXISTS (
                 SELECT 1
                   FROM pg_roles AS provider_role
                  WHERE provider_role.rolname IN ('anon', 'authenticated', 'service_role')
                    AND (
                      has_table_privilege(provider_role.rolname,
                        'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                      OR has_table_privilege(provider_role.rolname,
                        'programmable_website_projection_v1.explore_market_cap_authority_generations_v1',
                        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                      OR has_any_column_privilege(provider_role.rolname,
                        'programmable_website_projection_v1.explore_market_cap_authority_heads_v1',
                        'SELECT,INSERT,UPDATE,REFERENCES')
                      OR has_any_column_privilege(provider_role.rolname,
                        'programmable_website_projection_v1.explore_market_cap_authority_generations_v1',
                        'SELECT,INSERT,UPDATE,REFERENCES')
                    )
               ) AS provider_roles_excluded,
               COALESCE(ssl.ssl, false) AS ssl,
               ssl.version AS ssl_version,
               ssl.cipher AS ssl_cipher,
               ssl.bits AS ssl_bits
          FROM pg_roles AS role
          JOIN pg_namespace AS schema
            ON schema.nspname = 'programmable_website_projection_v1'
          JOIN pg_class AS heads
            ON heads.relnamespace = schema.oid
           AND heads.relname = 'explore_market_cap_authority_heads_v1'
          JOIN pg_class AS generations
            ON generations.relnamespace = schema.oid
           AND generations.relname = 'explore_market_cap_authority_generations_v1'
          LEFT JOIN pg_stat_ssl AS ssl ON ssl.pid = pg_backend_pid()
         WHERE role.rolname = current_user
           AND pg_get_userbyid(schema.nspowner) <> current_user
           AND pg_get_userbyid(heads.relowner) <> current_user
           AND pg_get_userbyid(generations.relowner) <> current_user
      `);
      const value = result.rows[0];
      if (result.rows.length !== 1 || value === undefined) {
        throw new TypeError(
          "Explore market-cap authority database attestation failed",
        );
      }
      assertExploreMarketCapAuthoritySecurityAttestationV1(
        value,
        this.#expectedRuntimeRole,
      );
    } finally {
      client.release();
    }
  }

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    const client = await this.#pool.connect();
    return new NodePostgresProjectionTargetClientV1(client);
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    const result = await this.#pool.query<Row & QueryResultRow>(
      text,
      [...values],
    );
    return { rows: result.rows, rowCount: result.rowCount };
  }
}

export function assertProjectionTargetSecurityAttestationV1(
  value: Readonly<ProjectionTargetSecurityAttestationRowV1>,
  expectedRuntimeRole: string,
): void {
  if (
    value.runtime_role !== expectedRuntimeRole
    || value.runtime_role !== "programmable_website_projection_runtime"
    || value.session_role !== value.runtime_role
    || value.rolsuper || value.rolcreaterole || value.rolcreatedb
    || value.rolreplication || value.rolbypassrls
    || !value.schema_usage || value.schema_create
    || !value.projections_select || !value.projections_insert
    || value.projections_mutate
    || !value.credentials_select || !value.credentials_insert
    || value.credentials_mutate
    || !value.registry_custom_select || !value.registry_custom_insert
    || !value.registry_custom_update || value.registry_custom_forbidden_mutate
    || !value.projections_rls || !value.projections_force_rls
    || !value.credentials_rls || !value.credentials_force_rls
    || !value.registry_custom_rls || !value.registry_custom_force_rls
    || !value.expected_policies || !value.provider_roles_excluded
    || !value.ssl || value.ssl_version === null
    || value.ssl_cipher === null || (value.ssl_bits ?? 0) < 128
  ) throw new TypeError("website projection database attestation failed");
}

export function assertGmgnAccountGateSecurityAttestationV1(
  value: Readonly<GmgnAccountGateSecurityAttestationRowV1>,
  expectedRuntimeRole: string,
): void {
  if (
    value.runtime_role !== expectedRuntimeRole
    || value.runtime_role !== "programmable_website_projection_runtime"
    || value.session_role !== value.runtime_role
    || value.rolsuper || value.rolcreaterole || value.rolcreatedb
    || value.rolreplication || value.rolbypassrls
    || !value.schema_usage || value.schema_create
    || !value.gmgn_gate_select || !value.gmgn_gate_update
    || value.gmgn_gate_forbidden_mutate || !value.gmgn_history_insert
    || !value.gmgn_history_delete || !value.gmgn_history_prune_columns
    || value.gmgn_history_forbidden_access
    || !value.gmgn_gate_rls || !value.gmgn_gate_force_rls
    || !value.gmgn_history_rls || !value.gmgn_history_force_rls
    || !value.gmgn_gate_singleton
    || !value.expected_policies || !value.provider_roles_excluded
    || !value.ssl || value.ssl_version === null
    || value.ssl_cipher === null || (value.ssl_bits ?? 0) < 128
  ) throw new TypeError("GMGN account gate database attestation failed");
}

export function assertGmgnAccountGateMultiflightSecurityAttestationV1(
  value: Readonly<GmgnAccountGateMultiflightSecurityAttestationRowV1>,
  expectedRuntimeRole: string,
): void {
  if (
    value.runtime_role !== expectedRuntimeRole
    || value.runtime_role !== "programmable_website_projection_runtime"
    || value.session_role !== value.runtime_role
    || value.rolsuper || value.rolcreaterole || value.rolcreatedb
    || value.rolreplication || value.rolbypassrls
    || !value.schema_usage || value.schema_create
    || !value.gmgn_leases_select || !value.gmgn_leases_insert
    || !value.gmgn_leases_delete || value.gmgn_leases_forbidden_access
    || !value.gmgn_leases_rls || !value.gmgn_leases_force_rls
    || !value.expected_policies || !value.provider_roles_excluded
    || !value.ssl || value.ssl_version === null
    || value.ssl_cipher === null || (value.ssl_bits ?? 0) < 128
  ) {
    throw new TypeError(
      "GMGN account gate multiflight database attestation failed",
    );
  }
}

export function assertExploreMarketCapAuthoritySecurityAttestationV1(
  value: Readonly<ExploreMarketCapAuthoritySecurityAttestationRowV1>,
  expectedRuntimeRole: string,
): void {
  if (
    value.runtime_role !== expectedRuntimeRole ||
    value.runtime_role !== "programmable_website_projection_runtime" ||
    value.session_role !== value.runtime_role ||
    value.rolsuper || value.rolcreaterole || value.rolcreatedb ||
    value.rolreplication || value.rolbypassrls ||
    !value.schema_usage || value.schema_create ||
    !value.heads_select || !value.heads_insert || !value.heads_delete ||
    !value.heads_update || value.heads_forbidden_access ||
    !value.generations_select || !value.generations_insert ||
    !value.generations_delete || value.generations_forbidden_access ||
    !value.heads_rls || !value.heads_force_rls ||
    !value.generations_rls || !value.generations_force_rls ||
    !value.expected_policies || !value.provider_roles_excluded ||
    !value.ssl || value.ssl_version === null ||
    value.ssl_cipher === null || (value.ssl_bits ?? 0) < 128
  ) {
    throw new TypeError(
      "Explore market-cap authority database attestation failed",
    );
  }
}

class NodePostgresProjectionTargetClientV1
implements ProjectionTargetPostgresClientV1 {
  readonly #client: PoolClient;

  constructor(client: PoolClient) {
    this.#client = client;
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    const result = await this.#client.query<Row & QueryResultRow>(
      text,
      [...values],
    );
    return { rows: result.rows, rowCount: result.rowCount };
  }

  release(): void {
    this.#client.release();
  }
}

function environmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function environmentId(name: string): string {
  const value = environmentValue(name);
  if (!SAFE_ID.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function environmentDigest(name: string): Sha256Digest {
  const value = environmentValue(name);
  if (!DIGEST.test(value)) throw new TypeError(`${name} is invalid`);
  return value as Sha256Digest;
}

function environmentPem(
  name: string,
  kind: "PUBLIC KEY" | "CERTIFICATE" = "PUBLIC KEY",
): string {
  const value = environmentValue(name).replaceAll("\\n", "\n");
  if (
    !value.startsWith(`-----BEGIN ${kind}-----\n`)
    || !value.endsWith(`\n-----END ${kind}-----`)
  ) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}
