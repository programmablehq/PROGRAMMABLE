import "server-only";
import type { Pool } from "pg";

export function handlePostgresPoolErrors(pool: Pool): void {
  pool.on("error", () => undefined);
  pool.on("connect", client => {
    // pg removes its idle-client listener during checkout. A disconnect between
    // transaction statements must not become an uncaught process exception.
    // pg still rejects pending/future queries and discards the broken client.
    client.on("error", () => undefined);
  });
}
