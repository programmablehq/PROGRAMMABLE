import { createRequire } from "node:module";
import { join } from "node:path";
import { simulateLifecycle } from "./validate-lifecycle.mjs";
const requireTool = createRequire(join(process.argv[2], "package.json"));
const requireLocal = createRequire(import.meta.url);
const bundle = requireLocal("./core-bundle.json");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; if (Buffer.byteLength(input) > 200_000) process.exit(3); });
process.stdin.on("end", async () => {
  try { process.stdout.write(JSON.stringify(await simulateLifecycle(requireTool, JSON.parse(input), bundle))); }
  catch { process.exitCode = 4; }
});
