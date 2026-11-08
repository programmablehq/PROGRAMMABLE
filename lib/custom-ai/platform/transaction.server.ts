import "server-only";
import type { AIConnection, AIPool } from "../store.server";
import type { ProjectScope } from "./types";
import { validateScope } from "./document";

export async function projectTransaction<T>(pool: AIPool, scope: ProjectScope, work: (db: AIConnection) => Promise<T>): Promise<T> {
  validateScope(scope);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('programmable.project_owner',$1,true)", [scope.ownerId]);
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { db.release(); }
}
