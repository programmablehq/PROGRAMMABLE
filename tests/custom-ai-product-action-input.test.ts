import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {decodeFunctionData,parseAbi,type AbiFunction} from "viem";
import {encodeProductFunctionInput} from "../lib/custom-ai/product/action-input";
import {prepareProductActionInput} from "../lib/custom-ai/product/action-prepare.server";
import type {ProductRuntimeSource} from "../lib/custom-ai/product/runtime-source.server";
const fn=(signature:string)=>parseAbi([signature])[0] as AbiFunction;
describe("typed product action inputs",()=>{
  it("keeps large token units exact and distinguishes overloaded functions",()=>{
    const method=fn("function claim(uint256 amount,address receiver)"),amount="123456789012345678901234567890";
    const input=encodeProductFunctionInput(method,{receiver:`0x${"1".repeat(40)}`,amount});
    expect(input.signature).toBe("claim(uint256,address)");expect(input.arguments[0]).toBe(amount);
    expect(decodeFunctionData({abi:[method],data:input.data}).args?.[0]).toBe(BigInt(amount));
    for(const invalid of [1.1,9007199254740992,"1.2","1e18","-1",(2n**256n).toString()])expect(()=>encodeProductFunctionInput(method,[invalid,`0x${"1".repeat(40)}`])).toThrow();
  });
  it("encodes named tuple arrays and signed values without guessing object order",()=>{
    const method=fn("function configure((address recipient,uint16 share)[] rules,int8 threshold,bool enabled)");
    const input=encodeProductFunctionInput(method,{enabled:"false",threshold:"-128",rules:[{share:"3000",recipient:`0x${"2".repeat(40)}`}]});
    expect(input.arguments).toEqual([[[`0x${"2".repeat(40)}`,"3000"]],"-128",false]);
    expect(()=>encodeProductFunctionInput(method,{enabled:"false",threshold:"-129",rules:[]})).toThrow();
    expect(()=>encodeProductFunctionInput(method,{enabled:"false",threshold:"1",rules:[],data:"0x1234"})).toThrow();
  });
  it("preserves explicit native value only for payable actions and bounds dynamic payloads",()=>{
    const payable=fn("function deposit(bytes memo) payable"),read=fn("function balance() view returns(uint256)");
    expect(encodeProductFunctionInput(payable,["0x1234"],"1000000000000000000").valueWei).toBe("1000000000000000000");
    expect(()=>encodeProductFunctionInput(read,[],"1")).toThrow();
    expect(()=>encodeProductFunctionInput(payable,["0x1"])).toThrow();
    expect(()=>encodeProductFunctionInput(payable,[`0x${"aa".repeat(2049)}`])).toThrow();
    expect(encodeProductFunctionInput(read,[]).read).toBe(true);
  });
  it("binds one action to the saved component and ABI without creating wallet authority",()=>{
    const caller=`0x${"1".repeat(40)}` as const,target=`0x${"2".repeat(40)}` as const;
    const source={id:`sha256:${"a".repeat(64)}`,implementationId:`sha256:${"b".repeat(64)}`,chainId:1,
      implementation:{actions:[{id:"claim",target:"vault",fixture:"vault-contract",signature:"claim(uint256)",mutability:"nonpayable"}],components:[{id:"vault",fixture:"vault-contract",source:"Vault.sol",contract:"Vault"}]},
      components:[{id:"vault",address:target}],contracts:[{source:"Vault.sol",contract:"Vault",abi:parseAbi(["function claim(uint256 amount)"])}]} as unknown as ProductRuntimeSource;
    const input=prepareProductActionInput(source,"claim",caller,["123"]);
    expect(input).toMatchObject({state:"inputs-encoded",authorized:false,caller,target,arguments:["123"]});
    expect(prepareProductActionInput(source,"claim",caller,["124"]).id).not.toBe(input.id);
    expect(()=>prepareProductActionInput(source,"claim-everything",caller,[])).toThrow();
    source.contracts[0].abi=parseAbi(["function claim(uint256 amount) payable"]);
    expect(()=>prepareProductActionInput(source,"claim",caller,["123"])).toThrow();
  });
});
