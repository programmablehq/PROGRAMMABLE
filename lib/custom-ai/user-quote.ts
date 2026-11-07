/** Recover an exact span from the latest user message, never from model or
 * tool text. Case/spacing and an omitted no-build note are formatting only;
 * every economic or authority word must still occur in order in that span. */
export function literalUserQuote(quote:string,source:string):string|undefined {
  if(!quote.trim())return undefined;
  if(source.includes(quote))return quote;
  const folded=(value:string)=>value.normalize("NFKC").replace(/[’‘]/gu,"'").toLowerCase();
  const needle=folded(quote).replace(/\s+/gu," ").trim();
  const omitted=[...source.matchAll(/\b(?:do not build yet|no build yet|noch (?:nichts|nicht|nix) bauen|nur besprechen)[.!]?\s*/giu)]
    .map(match=>({start:match.index!,end:match.index!+match[0].length}));
  for(const spans of [[],omitted]){
    let view="",offset=0;
    const starts:number[]=[],ends:number[]=[];
    for(const point of source){
      const start=offset;offset+=point.length;
      if(spans.some(span=>start>=span.start&&start<span.end))continue;
      const normalized=folded(point);
      for(let index=0;index<normalized.length;index++){
        const char=normalized[index];
        const value=/\s/u.test(char)?" ":char;
        if(value===" "&&view.endsWith(" "))continue;
        view+=value;starts.push(start);ends.push(offset);
      }
    }
    const at=view.indexOf(needle);
    if(at>=0)return source.slice(starts[at],ends[at+needle.length-1]);
  }
  return undefined;
}

export function literalRevisionQuotes(value:Record<string,unknown>,latest:string):Record<string,unknown> {
  const restore=(items:unknown)=>Array.isArray(items)?items.map(item=>{
    if(!item||typeof item!=="object"||typeof item.instruction!=="string")return item;
    const exact=literalUserQuote(item.instruction,latest);
    return exact===undefined?item:{...item,instruction:exact};
  }):items;
  return {...value,intentRequirements:restore(value.intentRequirements),ruleEdits:restore(value.ruleEdits)};
}
