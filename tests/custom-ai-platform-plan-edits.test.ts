import {expect,it} from "vitest";
import {applyPlanArchitectureUpdates} from "../lib/custom-ai/platform/plan-edits";

it("edits one saved scenario without repeating or changing the remaining plan",()=>{
 const prior={kind:"contract",production:{digest:"server-bound"},contractChecks:{contracts:[{id:"hook",functions:[{name:"customReward"}]}],scenarios:Array.from({length:36},(_,index)=>({id:`case-${index}`,steps:[{expected:index}]}))}};
 const result=applyPlanArchitectureUpdates(prior,[{operation:"set",path:["contractChecks","scenarios","0","steps","0","expected"],value:1}]);
 expect(result).toEqual({...prior,contractChecks:{...prior.contractChecks,scenarios:[{id:"case-0",steps:[{expected:1}]},...prior.contractChecks.scenarios.slice(1)]}});
 expect(prior.contractChecks.scenarios[0].steps[0].expected).toBe(0);
});
it("supports explicit appends and removals without creating missing parents",()=>{
 expect(applyPlanArchitectureUpdates({checks:[{id:"a"}]},[{operation:"set",path:["checks","1"],value:{id:"b"}},{operation:"remove",path:["checks","0"]}])).toEqual({checks:[{id:"b"}]});
 expect(()=>applyPlanArchitectureUpdates({checks:[]},[{operation:"set",path:["missing","field"],value:1}])).toThrow();
});
it("can edit an own constructor declaration without traversing inherited properties",()=>{
 const previous={contractChecks:{contracts:[{id:"hook",constructor:{arguments:["1"]}}]}};
 expect(applyPlanArchitectureUpdates(previous,[{operation:"set",path:["contractChecks","contracts","0","constructor","arguments","0"],value:"2"}])).toEqual({contractChecks:{contracts:[{id:"hook",constructor:{arguments:["2"]}}]}});
});
it.each([
 [{operation:"set",path:[],value:1}],
 [{operation:"set",path:["__proto__","polluted"],value:true}],
 [{operation:"set",path:["constructor","prototype"],value:{polluted:true}}],
 [{operation:"set",path:["production"],value:{digest:"model-invented"}}],
 [{operation:"set",path:["checks","-1"],value:1}],
 [{operation:"set",path:["checks","04"],value:1}],
 [{operation:"set",path:["checks","2"],value:1}],
 [{operation:"remove",path:["unknown"]}],
 [{operation:"set",path:["checks"]}],
 Array.from({length:65},()=>({operation:"set",path:["title"],value:"x"})),
])("rejects unsafe or invalid updates atomically: %j",(...update)=>{
 const previous={checks:[{id:"a"}]};expect(()=>applyPlanArchitectureUpdates(previous,update)).toThrow();expect(previous).toEqual({checks:[{id:"a"}]});expect(Object.prototype).not.toHaveProperty("polluted");
});
it("requires an existing architecture and a nonempty update list",()=>{
 expect(()=>applyPlanArchitectureUpdates(null,[{operation:"set",path:["kind"],value:"contract"}])).toThrow();
 expect(()=>applyPlanArchitectureUpdates({},[])).toThrow();
});
