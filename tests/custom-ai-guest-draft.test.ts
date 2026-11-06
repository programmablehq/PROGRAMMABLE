import {describe,expect,it} from "vitest";
import {clearGuestDraft,readGuestDraft,writeGuestDraft} from "../lib/custom-ai/guest-draft";

function storage(){
  const values=new Map<string,string>();
  return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);},values};
}
describe("unsubmitted guest input",()=>{
  it("restores exact text only in its tab storage and can clear it on sign-in",()=>{
    const tab=storage(),otherTab=storage(),text="  A 2% fee\nfalling over 24 hours  ";
    writeGuestDraft(text,tab,1000);
    expect(readGuestDraft(tab,2000)).toBe(text);
    expect(readGuestDraft(otherTab,2000)).toBe("");
    clearGuestDraft(tab);expect(readGuestDraft(tab,2000)).toBe("");
  });
  it("drops expired, future, empty, oversized or secret-looking input",()=>{
    const tab=storage();writeGuestDraft("A saved idea",tab,1000);
    expect(readGuestDraft(tab,1000+24*60*60_000)).toBe("");
    expect(readGuestDraft(tab,999)).toBe("");
    for(const text of [" ","x".repeat(8001),"-----BEGIN PRIVATE KEY----- synthetic"]){
      writeGuestDraft(text,tab,2000);expect(tab.values.size).toBe(0);
    }
  });
  it("keeps editing available when browser storage is unavailable",()=>{
    const blocked={getItem(){throw Error("blocked");},setItem(){throw Error("blocked");},removeItem(){throw Error("blocked");}};
    expect(readGuestDraft(blocked)).toBe("");
    expect(()=>writeGuestDraft("My idea",blocked)).not.toThrow();
  });
});
