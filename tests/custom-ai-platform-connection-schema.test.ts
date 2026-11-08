import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {assertConnectionSchema,matchesConnectionSchema} from "../lib/custom-ai/platform/connection-schema.server";

it("preserves ordinary schema validation and rejects asynchronous schemas",()=>{
 const schema={type:"object",properties:{id:{type:"string",pattern:"^[a-z0-9-]+$"}},required:["id"],additionalProperties:false};
 expect(()=>assertConnectionSchema(schema)).not.toThrow();
 expect(matchesConnectionSchema(schema,{id:"player-123"})).toBe(true);
 expect(matchesConnectionSchema(schema,{id:"not allowed"})).toBe(false);
 expect(()=>assertConnectionSchema({$async:true,type:"string"})).toThrow();
});
it("interrupts expensive patterns in values and property names",()=>{
 const text="a".repeat(35)+"!",started=Date.now();
 expect(matchesConnectionSchema({type:"string",pattern:"^(a+)+$"},text)).toBe(false);
 expect(matchesConnectionSchema({type:"object",propertyNames:{pattern:"^(a+)+$"}},{[text]:1})).toBe(false);
 expect(Date.now()-started).toBeLessThan(3000);
 expect(matchesConnectionSchema({type:"string"},"still responsive")).toBe(true);
});
