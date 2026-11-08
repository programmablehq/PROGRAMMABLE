import {describe,it,expect} from "vitest";
import {validateDeclaredInterfaceCalls} from "../lib/custom-ai/declared-interface-calls";
import type {GeneralCheckScenarios} from "../lib/custom-ai/behavior-checks";
import type {GeneralDeploymentBlueprint} from "../lib/custom-ai/deployment-blueprint";
import {parseV4CheckWorld} from "../lib/custom-ai/behavior-world";
const plan=()=>({contracts:[{id:"main",source:"Main.sol",contract:"Main",arguments:[],functions:["function set(bool enabled)","function initialize(address owner,uint256 minimum)"],allowReceive:false,allowFallback:false,surfaceRequirements:[]}],allowedCalls:[],
 steps:[{id:"set",contract:"main",signature:"set(bool)",arguments:[false],from:"creator",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"}}]}) as GeneralCheckScenarios;
describe("independently declared call types",()=>{
 it("preserves a real false boolean but rejects its truthy string spelling",()=>{
  expect(()=>validateDeclaredInterfaceCalls(plan())).not.toThrow();const invalid=plan();invalid.steps[0].arguments=["false"];
  expect(()=>validateDeclaredInterfaceCalls(invalid)).toThrow("argument 0 expects bool");
 });
 it("rejects an address form input in a numeric initializer parameter",()=>{
  const target={id:"main",source:"Main.sol",contract:"Main",initializer:{function:"initialize",arguments:[{input:"controller"},{input:"quote"}]}};
  expect(()=>validateDeclaredInterfaceCalls(plan(),{targets:[target]} as GeneralDeploymentBlueprint)).toThrow("argument 1 expects uint256");
  target.initializer.arguments[1]={input:"funding"};
  expect(()=>validateDeclaredInterfaceCalls(plan(),{targets:[target]} as GeneralDeploymentBlueprint)).not.toThrow();
 });
 it("checks actual swap tuple booleans on the trusted world router",()=>{
  const p=plan();p.world={kind:"v4-native-token-v1",token:"token",hook:"main",hookPermissions:128,fee:0,tickSpacing:60,sqrtPriceX96:"79228162514264337593543950336"};
  p.steps=[{...p.steps[0],contract:"v4-router",signature:"swap((address,address,uint24,int24,address),(bool,int256,uint160),bytes)",arguments:[{pool:true},[true,"-1","4295128740"],"0x"]}];
  expect(()=>validateDeclaredInterfaceCalls(p)).not.toThrow();p.steps[0].arguments[1]=["false","-1","4295128740"];
  expect(()=>validateDeclaredInterfaceCalls(p)).toThrow("argument 1");
 });
 it("rejects missing protected child call targets before paying for source",()=>{
  const p=plan();p.world=parseV4CheckWorld({kind:"v4-protected-native-token-v1",token:"token",hook:"main",initializer:"initializer",hookPermissions:8396,fee:0,tickSpacing:60,sqrtPriceX96:"79228162514264337593543950336",nativeUsdAnswer:"300000000000"},new Set(["token","main","initializer"]));
  p.constructorChildren=[{...p.contracts[0],id:"fee-vault",parent:"main",creation:"create",nonce:"1",value:"0"}];
  expect(()=>validateDeclaredInterfaceCalls(p)).not.toThrow();
  p.steps.push({...p.steps[0],id:"initialize",contract:"initializer",signature:"initialize(address,address,int24,address,uint256)",arguments:[]});
  expect(()=>validateDeclaredInterfaceCalls(p)).toThrow("child call targets missing from allowedCalls: fee-vault");
  p.allowedCalls=[{contract:"fee-vault"}];
  expect(()=>validateDeclaredInterfaceCalls(p)).not.toThrow();
 });
 it("allows normalized local signatures only in bytes step arguments",()=>{
  const p=plan();const signature={signature:{kind:"wallet-link" as const,signer:"signer-player-a" as const,contract:"main",values:[]}};
  p.contracts[0].functions=["function check(bytes value) returns(bytes)","function other(bytes32 value)","function initialize(bytes value)"];
  p.steps=[{...p.steps[0],signature:"check(bytes)",arguments:[signature]}];
  expect(()=>validateDeclaredInterfaceCalls(p)).not.toThrow();
  p.steps[0].signature="other(bytes32)";
  expect(()=>validateDeclaredInterfaceCalls(p)).toThrow("expects bytes32");
  p.steps[0].signature="check(bytes)";p.steps[0].expect.returns=[signature];
  expect(()=>validateDeclaredInterfaceCalls(p)).toThrow("return 0 expects bytes");
  delete p.steps[0].expect.returns;
  const deployment={targets:[{id:"main",source:"Main.sol",contract:"Main",initializer:{function:"initialize",arguments:[signature]}}]} as unknown as GeneralDeploymentBlueprint;
  expect(()=>validateDeclaredInterfaceCalls(p,deployment)).toThrow("initializer argument 0 expects bytes");
 });
});
