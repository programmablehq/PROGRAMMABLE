import "server-only";
import {Script} from "node:vm";
import Ajv from "ajv";

// This is an execution deadline for trusted validator code, not a sandbox for
// arbitrary JavaScript. Schemas and values remain JSON data, including patterns.
const work=new Script(`
  const validator=new Ajv({strict:false}).compile(schema);
  if(validator.$async)throw new Error("Use a synchronous connection schema.");
  validate ? validator(value)===true : true;
`);
function evaluate(schema:object,value:unknown,validate:boolean):boolean {
  return work.runInNewContext({Ajv,schema,value,validate},{timeout:100,microtaskMode:"afterEvaluate",displayErrors:false})===true;
}
export function assertConnectionSchema(schema:object):void {evaluate(schema,undefined,false);}
export function matchesConnectionSchema(schema:object,value:unknown):boolean {
  try{return evaluate(schema,value,true);}catch{return false;}
}
