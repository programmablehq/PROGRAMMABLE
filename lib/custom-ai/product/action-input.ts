import {encodeFunctionData,getAddress,toFunctionSignature,type AbiFunction,type AbiParameter,type Hex} from "viem";

type Value=string|boolean|Value[];
export type ProductFunctionInput={signature:string;arguments:Value[];data:Hex;valueWei:string;read:boolean};
const fail=(field:string):never=>{throw new TypeError(`Check ${field}. Use the value and units required by this contract.`);};
const jsonObject=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v)));

/** ABI input codec only. It does not select a target, grant authority, estimate
 * gas, execute a contract or assume that an integer represents whole tokens. */
export function encodeProductFunctionInput(fn:AbiFunction,raw:unknown,valueWei:unknown="0"):ProductFunctionInput{
  if(fn.type!=="function"||fn.inputs.length>24)return fail("the contract function");
  let bytes:number;try{bytes=new TextEncoder().encode(JSON.stringify(raw)).length;}catch{return fail("the function inputs");}
  if(bytes>16_384)return fail("the input size");
  let count=0;
  const integer=(raw:unknown,signed:boolean,bits:number,field:string)=>{
    if(typeof raw!=="string"||! /^-?(?:0|[1-9][0-9]{0,77})$/.test(raw.trim())||bits<8||bits>256||bits%8)return fail(field);
    const value=BigInt(raw.trim()),min=signed?-(1n<<BigInt(bits-1)):0n,max=(1n<<BigInt(signed?bits-1:bits))-1n;
    if(value<min||value>max)return fail(field);return value;
  };
  const tupleValues=(parameters:readonly AbiParameter[],raw:unknown,field:string):unknown[]=>{
    if(Array.isArray(raw)){if(raw.length!==parameters.length)return fail(field);return raw;}
    const names=parameters.map(p=>p.name??"");
    if(!jsonObject(raw)||names.some(name=>!name)||new Set(names).size!==names.length
      ||Object.keys(raw).sort().join("\0")!==[...names].sort().join("\0"))return fail(field);
    return names.map(name=>raw[name]);
  };
  const parse=(parameter:AbiParameter,raw:unknown,field:string,depth:number):unknown=>{
    if(depth>5||++count>256)return fail("the input size");
    const array=/^(.*)\[([0-9]*)\]$/.exec(parameter.type);
    if(array){
      const length=array[2]?Number(array[2]):null;
      if(!Array.isArray(raw)||raw.length>32||length!==null&&raw.length!==length)return fail(field);
      return raw.map((value,index)=>parse({...parameter,type:array[1]} as AbiParameter,value,`${field}[${index}]`,depth+1));
    }
    if(parameter.type==="tuple"){
      if(!("components"in parameter)||!Array.isArray(parameter.components))return fail(field);
      const values=tupleValues(parameter.components,raw,field);
      return parameter.components.map((child:AbiParameter,index:number)=>parse(child,values[index],`${field}.${child.name||index+1}`,depth+1));
    }
    const number=/^(u?int)([0-9]*)$/.exec(parameter.type);
    if(number)return integer(raw,number[1]==="int",Number(number[2]||256),field);
    if(parameter.type==="address"){
      if(typeof raw!=="string")return fail(field);
      try{return getAddress(raw.trim());}catch{return fail(field);}
    }
    if(parameter.type==="bool"){
      if(typeof raw==="boolean")return raw;
      if(typeof raw==="string"&&["true","false"].includes(raw.trim()))return raw.trim()==="true";
      return fail(field);
    }
    if(parameter.type==="string"){
      if(typeof raw!=="string"||new TextEncoder().encode(raw).length>2048)return fail(field);return raw;
    }
    const data=/^bytes([0-9]*)$/.exec(parameter.type);
    if(data){
      const size=data[1]?Number(data[1]):null;
      if(typeof raw!=="string"||!/^0x(?:[a-f0-9]{2})*$/i.test(raw)||raw.length>4098
        ||size!==null&&(size<1||size>32||raw.length!==2+size*2))return fail(field);
      return raw.toLowerCase();
    }
    return fail(field);
  };
  const values=tupleValues(fn.inputs,raw,"the function inputs");
  const args=fn.inputs.map((parameter,index)=>parse(parameter,values[index],parameter.name||`input ${index+1}`,0));
  const amount=integer(valueWei,false,256,"the native amount (wei)");
  if(amount!==0n&&fn.stateMutability!=="payable")return fail("the native amount; this function is not payable");
  let data:Hex;try{data=encodeFunctionData({abi:[fn],functionName:fn.name,args});}catch{return fail("the function inputs");}
  if(data.length>16_386)return fail("the encoded input size");
  const display=(value:unknown):Value=>typeof value==="bigint"?value.toString():Array.isArray(value)?value.map(display):value as string|boolean;
  return {signature:toFunctionSignature(fn),arguments:args.map(display),data,valueWei:amount.toString(),read:fn.stateMutability==="view"||fn.stateMutability==="pure"};
}
