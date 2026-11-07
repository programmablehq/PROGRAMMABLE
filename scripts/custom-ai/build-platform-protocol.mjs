import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const source = await readFile(new URL("../../specs/project-runtime/v1/protocol.ts", import.meta.url), "utf8");
const hash = createHash("sha256").update(source).digest("hex");
const generated = `// Generated from specs/project-runtime/v1/protocol.ts. Do not edit.\nexport const PROJECT_PROTOCOL_HASH = "sha256:${hash}";\n${source}`;
const paths = [new URL("../../lib/custom-ai/platform/protocol.generated.ts", import.meta.url)];
const external = process.argv.find(argument => argument.startsWith("--backend-output="));
if (external) paths.push(pathToFileURL(external.slice("--backend-output=".length)));
for (const path of paths) {
  if (process.argv.includes("--check")) {
    if (await readFile(path, "utf8") !== generated) throw new Error("Project runtime protocol binding is stale");
  } else {
    await mkdir(dirname(path.pathname), { recursive: true });
    await writeFile(path, generated);
  }
}
