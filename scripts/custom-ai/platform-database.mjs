#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const root = fileURLToPath(new URL("../../", import.meta.url));
const schemaPath = new URL("../../ops/project-platform/schema-v1.sql", import.meta.url);
const immutable = new Set(["revisions", "idempotency", "check_evidence", "contract_checkpoints", "app_receipts", "webhook_inbox"]);
const routing = new Set(["dispatch_outbox", "sandbox_slots", "sandbox_usage", "webhook_routes", "app_key_index", "hosting_slots", "release_queue", "app_control_queue", "app_job_queue", "game_event_routes"]);
const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const identifier = value => {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("Invalid database role or table identifier");
  return `"${value}"`;
};

export async function platformDatabasePlan({ runtimeRole, expectedDatabase, commit }) {
  identifier(runtimeRole);
  if (typeof expectedDatabase !== "string" || !expectedDatabase || expectedDatabase.length > 63 || !/^[a-f0-9]{40}$/.test(commit)) throw new Error("A pinned commit and exact database are required");
  const sql = await readFile(schemaPath, "utf8");
  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS programmable_projects_v1\.([a-z_0-9]+)\s*\(/g)].map(match => match[1]).sort();
  if (!tables.length || new Set(tables).size !== tables.length || [...immutable, ...routing].some(name => !tables.includes(name))) throw new Error("Unexpected platform schema inventory");
  const body = { version: 1, commit, expectedDatabase, runtimeRole, schemaHash: hash(sql), tables };
  return { ...body, planHash: hash(JSON.stringify(body)) };
}

async function validatePlan(plan) {
  const expected = await platformDatabasePlan(plan);
  if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error("The migration plan does not match the reviewed source");
  return expected;
}

/** The caller owns the connection. All DDL, grants and validation share one
 * transaction; dry-run exercises the same path and rolls it back. */
export async function executePlatformDatabasePlan(db, plan, mode) {
  await validatePlan(plan);
  if (!["verify", "dry-run", "apply"].includes(mode)) throw new Error("Invalid migration mode");
  const role = identifier(plan.runtimeRole), tableName = name => `programmable_projects_v1.${identifier(name)}`;
  await db.query(mode === "verify" ? "BEGIN READ ONLY" : "BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='30s'");
    const actual = (await db.query("SELECT current_database() AS name")).rows[0];
    if (actual?.name !== plan.expectedDatabase) throw new Error("The connected database is not the reviewed target");
    const runtime = (await db.query("SELECT rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=$1", [plan.runtimeRole])).rows[0];
    if (!runtime?.rolcanlogin || runtime.rolsuper || runtime.rolbypassrls) throw new Error("The runtime role must be a non-privileged existing login");
    if (mode !== "verify") {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('programmable-project-platform-schema-v1',0))");
      await db.query(await readFile(schemaPath, "utf8"));
      await db.query(`GRANT USAGE ON SCHEMA programmable_projects_v1 TO ${role}`);
      const history = plan.tables.filter(name => immutable.has(name)), mutable = plan.tables.filter(name => !immutable.has(name));
      await db.query(`GRANT SELECT,INSERT ON ${history.map(tableName).join(",")} TO ${role}`);
      await db.query(`REVOKE UPDATE,DELETE,TRUNCATE ON ${history.map(tableName).join(",")} FROM ${role}`);
      await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${mutable.map(tableName).join(",")} TO ${role}`);
      await db.query(`REVOKE TRUNCATE ON ALL TABLES IN SCHEMA programmable_projects_v1 FROM ${role}`);
    }
    const tables = (await db.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,has_table_privilege($1,c.oid,'SELECT') AS can_read,has_table_privilege($1,c.oid,'INSERT') AS can_insert,has_table_privilege($1,c.oid,'UPDATE') AS can_update,has_table_privilege($1,c.oid,'DELETE') AS can_delete,has_table_privilege($1,c.oid,'TRUNCATE') AS can_truncate FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='programmable_projects_v1' AND c.relkind='r' ORDER BY c.relname", [plan.runtimeRole])).rows;
    if (tables.length !== plan.tables.length || tables.some((row, index) => row.relname !== plan.tables[index])) throw new Error("The live table inventory differs from the reviewed schema");
    for (const table of tables) {
      if (!table.can_read || !table.can_insert || table.can_truncate || immutable.has(table.relname) && (table.can_update || table.can_delete)
        || !immutable.has(table.relname) && (!table.can_update || !table.can_delete)
        || !routing.has(table.relname) && (!table.relrowsecurity || !table.relforcerowsecurity)) throw new Error(`Runtime privileges or row security differ for ${table.relname}`);
    }
    await db.query(mode === "apply" ? "COMMIT" : "ROLLBACK");
    return { planHash: plan.planHash, commit: plan.commit, database: plan.expectedDatabase, runtimeRole: plan.runtimeRole, tables: tables.length, mode, committed: mode === "apply" };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function cleanCommit() {
  if (execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim()) throw new Error("Use a clean reviewed checkout for database operations");
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

async function main() {
  const [mode, ...args] = process.argv.slice(2), flags = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!/^--[a-z-]+$/.test(args[index]) || !args[index + 1] || flags.has(args[index])) throw new Error("Use named, non-duplicate operator arguments");
    flags.set(args[index], args[index + 1]);
  }
  const commit = cleanCommit();
  if (mode === "plan") {
    if ([...flags.keys()].some(key => !["--runtime-role", "--database", "--output"].includes(key)) || !flags.has("--output")) throw new Error("plan requires --runtime-role, --database and --output");
    const plan = await platformDatabasePlan({ runtimeRole: flags.get("--runtime-role"), expectedDatabase: flags.get("--database"), commit });
    await writeFile(flags.get("--output"), JSON.stringify(plan, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    process.stdout.write(JSON.stringify({ planHash: plan.planHash, tables: plan.tables.length }) + "\n");
    return;
  }
  if (!["verify", "dry-run", "apply"].includes(mode) || [...flags.keys()].some(key => !["--plan", "--confirm-plan"].includes(key)) || !flags.has("--plan")) throw new Error("Use verify, dry-run or apply with --plan");
  const plan = JSON.parse(await readFile(flags.get("--plan"), "utf8"));
  await validatePlan(plan);
  if (plan.commit !== commit || mode === "apply" && flags.get("--confirm-plan") !== plan.planHash) throw new Error("Review and confirm the exact clean-commit migration plan");
  const raw = process.env.PROGRAMMABLE_MIGRATOR_DATABASE_URL, ca = process.env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM;
  if (!raw || !ca) throw new Error("The dedicated migrator URL and database CA are required");
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || !url.pathname.slice(1)) throw new Error("Invalid migrator connection configuration");
  const db = new pg.Client({ host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), ssl: { ca, rejectUnauthorized: true, servername: url.hostname }, connectionTimeoutMillis: 10000, application_name: "programmable-project-platform-migrator-v1" });
  try { await db.connect(); process.stdout.write(JSON.stringify(await executePlatformDatabasePlan(db, plan, mode)) + "\n"); }
  finally { await db.end(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => { process.stderr.write("Platform database operation failed; no credentials were printed. Check the reviewed target, role, plan and connection.\n"); process.exitCode = 1; });
}
