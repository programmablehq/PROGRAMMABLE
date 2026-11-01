// Compile only the reviewed local fixture against the existing pinned source
// closure. Never accepts submitted paths, compiler settings or network input.
import {readFile,writeFile,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
const sha=value=>createHash("sha256").update(value).digest("hex");
const root=fileURLToPath(new URL("../../",import.meta.url)),directory=fileURLToPath(new URL("./",import.meta.url));
const toolchain=await realpath(process.env.CUSTOM_AI_COMPILER_DIR??join(directory,"toolchain"));
const requireTool=createRequire(join(toolchain,"package.json")),solc=requireTool("solc");
if(solc.version()!=="0.8.26+commit.8a97fa7a.Emscripten.clang")throw Error("Wrong trusted fixture compiler");
const [closureBytes,source]=await Promise.all([readFile(join(root,"contracts/spec/custom-ai/verification-bundle/standard-input.json")),readFile(join(directory,"GeneralV4Fixture.sol"),"utf8")]);
const closure=JSON.parse(closureBytes),sources={...closure.sources,"GeneralV4Fixture.sol":{content:source}};
const settings={optimizer:{enabled:true,runs:1000},viaIR:false,evmVersion:"cancun",remappings:closure.settings.remappings,
 metadata:{bytecodeHash:"none",appendCBOR:false},outputSelection:{"GeneralV4Fixture.sol":{"GeneralV4Fixture":["abi","evm.bytecode.object","evm.deployedBytecode.object","evm.deployedBytecode.immutableReferences"]}}};
const output=JSON.parse(solc.compile(JSON.stringify({language:"Solidity",sources,settings})));
if(output.errors?.some(item=>item.severity==="error"))throw Error(output.errors.filter(item=>item.severity==="error").map(item=>item.formattedMessage).join("\n"));
const artifact=output.contracts["GeneralV4Fixture.sol"].GeneralV4Fixture;
const payload={version:"general-v4-fixture-v1",compiler:solc.version(),sourceSha256:sha(source),dependencyClosureSha256:sha(closureBytes),
 abi:artifact.abi,creationBytecode:"0x"+artifact.evm.bytecode.object,runtimeTemplate:"0x"+artifact.evm.deployedBytecode.object,immutableReferences:artifact.evm.deployedBytecode.immutableReferences};
const result={...payload,hash:sha(JSON.stringify(payload))};
const serialized=JSON.stringify(result)+"\n",destination=join(directory,"general-v4-fixture.json");
if(process.argv.includes("--check")){
 if(await readFile(destination,"utf8")!==serialized)throw Error("Trusted general v4 fixture is not reproduced by its exact saved source closure");
}else await writeFile(destination,serialized);
console.log(JSON.stringify({version:result.version,hash:result.hash,creationBytes:artifact.evm.bytecode.object.length/2}));
