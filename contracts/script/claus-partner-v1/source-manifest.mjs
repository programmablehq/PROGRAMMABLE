import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root=fileURLToPath(new URL("../../",import.meta.url));
const artifact=JSON.parse(await readFile(path.join(root,"out/claus-partner-v1/ClausQuoteInitializerV1.sol/ClausQuoteInitializerV1.json"),"utf8"));
const metadata=typeof artifact.metadata==="string"?JSON.parse(artifact.metadata):artifact.metadata;
const canonical=v=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(",")}]`:
  `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
const manifest={schemaVersion:"programmable.claus-kernel-source.v1",compilerVersion:"0.8.26+commit.8a97fa7a",
  sources:Object.fromEntries(Object.entries(metadata.sources).sort(([a],[b])=>a.localeCompare(b)).map(([p,v])=>[p,v.keccak256]))};
const kernelSourceHash=`sha256:${createHash("sha256").update(canonical(manifest)).digest("hex")}`;
await writeFile(path.join(root,"src/claus-partner-v1/source-manifest.json"),JSON.stringify({kernelSourceHash,...manifest},null,2)+"\n");
process.stdout.write(JSON.stringify({kernelSourceHash,sourceFiles:Object.keys(manifest.sources).length})+"\n");
