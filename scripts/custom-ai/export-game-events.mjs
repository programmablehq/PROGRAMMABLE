import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {keccak256} from "viem";
const root=resolve(import.meta.dirname,"../.."),sources={},artifacts={};
for(const name of ["ProjectGameEventsV1","ProjectGameFeeModuleV1"]){
 const build=JSON.parse(await readFile(resolve(root,`contracts/out/custom-ai/${name}.sol/${name}.json`),"utf8"));
 if(build.metadata.compiler.version!=="0.8.26+commit.8a97fa7a")throw Error("Unexpected game event compiler");
 for(const [path,metadata]of Object.entries(build.metadata.sources)){
  const file=resolve(root,"contracts",path);if(!file.startsWith(root+"/contracts/"))throw Error("Invalid dependency path");
  const bytes=await readFile(file);if(keccak256(bytes)!==metadata.keccak256)throw Error(`Stale game event source: ${path}`);
  sources[path]={content:bytes.toString("utf8"),sha256:createHash("sha256").update(bytes).digest("hex")};
 }
 artifacts[name]={abi:build.abi,initCode:build.bytecode.object,runtimeTemplate:build.deployedBytecode.object,immutableReferences:build.deployedBytecode.immutableReferences};
}
const payload={version:"programmable.project-game-events.v1",compiler:"0.8.26+commit.8a97fa7a",sources,artifacts};
const output=JSON.stringify({...payload,bundleHash:`sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`})+"\n";
const target=resolve(root,"lib/custom-ai/platform/game-events-code.json");
if(process.argv.includes("--check")){if(await readFile(target,"utf8")!==output)throw Error("Stale game event package");}else await writeFile(target,output);
console.log(JSON.stringify({contracts:Object.keys(artifacts),sources:Object.keys(sources).length,bytes:Buffer.byteLength(output)}));
