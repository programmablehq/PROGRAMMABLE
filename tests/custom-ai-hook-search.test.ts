import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const {read}=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/server/unified-explore",()=>({readUnifiedLaunches:read}));
import search from "../lib/custom-ai/capabilities/search-hooks/index.server";
import {dispatchTool} from "../lib/custom-ai/capabilities/dispatch.server";
const context=()=>({owner:"owner-a",chainId:1 as const,allowWeb:false,budget:{remaining:1}});
beforeEach(()=>{read.mockReset();read.mockResolvedValue({status:"ready",updatedAt:"2026-10-29T00:00:00Z",items:[{chainId:1,mode:"custom",name:"Rain",symbol:"RAIN",tokenAddress:`0x${"1".repeat(40)}`,hookAddress:`0x${"2".repeat(40)}`} ]});});
describe("bounded hook catalog search",()=>{
  it("keeps the selected network and returns launch references without an audit claim",async()=>{
    const result=await dispatchTool(search.ref,{query:"Rain",chain:"current"},context(),[search]);
    expect(read).toHaveBeenCalledWith(1,"Rain",{sort:"newest",mode:"custom",chain:1},6);
    expect(result.sources).toHaveLength(1);expect(JSON.stringify(result.facts)).toContain("Read the actual source");
  });
  it("rejects unbounded input before touching the catalog",async()=>{
    await expect(dispatchTool(search.ref,{query:"x".repeat(129),chain:"all"},context(),[search])).rejects.toMatchObject({code:"capability_input"});
    expect(read).not.toHaveBeenCalled();
  });
});
