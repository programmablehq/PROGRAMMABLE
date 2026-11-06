function statedPlatformRates(text:string):number[] {
  const term="(?:platform(?:\\s+(?:fee|share|component))?|plattform(?:geb[uü]hr|anteil)?)";
  const number="(\\d+(?:[.,]\\d+)?)\\s*(%|bps?)";
  const patterns=[new RegExp(`${number}\\s*(?:fixed\\s+)?${term}`,"giu"),
    new RegExp(`${term}\\s*(?:(?:is|of|at|von|betr[aä]gt|:|=)\\s*)?${number}`,"giu")];
  return patterns.flatMap(pattern=>[...text.matchAll(pattern)].map(match=>
    Number(match[1].replace(",","."))*(match[2]==="%"?10_000:100)));
}

/** A model-added platform default is not a user choice. Catch a rate copied
 * from another execution route before it becomes part of the saved intent. */
export function hasInventedPlatformRate(texts:readonly string[],userText:string,ratePpm:number):boolean {
  if(statedPlatformRates(userText).length)return false;
  return texts.some(text=>statedPlatformRates(text).some(rate=>rate!==ratePpm));
}
