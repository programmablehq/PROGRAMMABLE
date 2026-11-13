import { createServer, type Socket } from "node:net";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { handlePostgresPoolErrors } from "../lib/server/postgres-pool-errors";

const message = (tag: string, payload: Buffer) => {
  const size = Buffer.alloc(4);
  size.writeInt32BE(payload.length + 4);
  return Buffer.concat([Buffer.from(tag), size, payload]);
};

it("survives a checked-out socket disconnect and uses a new connection for the next request", async () => {
  const sockets: Socket[] = [];
  const server = createServer(socket => {
    sockets.push(socket);
    socket.on("error", () => undefined);
    let buffer = Buffer.alloc(0), started = false;
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      if (!started) {
        if (buffer.length < 4 || buffer.length < buffer.readInt32BE()) return;
        buffer = buffer.subarray(buffer.readInt32BE());
        started = true;
        socket.write(Buffer.concat([
          message("R", Buffer.alloc(4)),
          message("Z", Buffer.from("I")),
        ]));
      }
      while (buffer.length >= 5 && buffer.length >= buffer.readInt32BE(1) + 1) {
        const tag = String.fromCharCode(buffer[0]);
        buffer = buffer.subarray(buffer.readInt32BE(1) + 1);
        if (tag === "Q") socket.write(Buffer.concat([
          message("C", Buffer.from("SELECT 1\0")),
          message("Z", Buffer.from("I")),
        ]));
        if (tag === "X") socket.end();
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing test endpoint");
  const pool = new Pool({ host: "127.0.0.1", port: address.port, user: "fixture",
    database: "fixture", ssl: false, max: 1, connectionTimeoutMillis: 1000 });
  handlePostgresPoolErrors(pool);
  const client = await pool.connect();
  let released = false;
  try {
    await client.query("SELECT 1");
    const ended = new Promise<void>(resolve => client.once("end", resolve));
    sockets[0].destroy();
    await ended;
    await expect(client.query("SELECT 1")).rejects.toThrow(/connection error|not queryable/u);
    client.release();
    released = true;
    expect((await pool.query("SELECT 1")).rowCount).toBe(1);
    expect(sockets).toHaveLength(2);
  } finally {
    if (!released) client.release();
    await pool.end();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
