import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("./toolchain/", import.meta.url));
const lock = await readFile(new URL("./toolchain/package-lock.json", import.meta.url));
const hash = createHash("sha256").update(lock).digest("hex");
const stamp = new URL("./toolchain/node_modules/.custom-ai-lock", import.meta.url);
if (await readFile(stamp, "utf8").catch(() => "") !== hash) {
  const result = spawnSync("npm", ["ci", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund"], { cwd: directory, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  await writeFile(stamp, hash);
}
