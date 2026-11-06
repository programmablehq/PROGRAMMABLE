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

function labelledRates(text:string,kind:"project"|"total"):number[] {
  const label=kind==="project"?"(?:(?:project|additional)(?: swap)? (?:fees?|tax)|projektgeb[uü]hr(?:en)?|projektfees)"
    :"(?:total(?: swap)? (?:fees?|tax)|gesamtgeb[uü]hr(?:en)?)";
  const number="(\\d+(?:[.,]\\d+)?)\\s*(%|percent|prozent|bps?)";
  const patterns=[new RegExp(`${label}[^.!?;%\\n]{0,35}?${number}`,"giu"),
    new RegExp(`${number}\\s*(?:[\\p{L}-]+\\s+){0,5}${label}`,"giu")];
  const negated=(value:string)=>/\b(?:not|no|never|isn't|isn’t|nicht|kein\w*)\b/iu.test(value);
  const rates=patterns.flatMap(pattern=>[...text.matchAll(pattern)].filter(match=>!negated(match[0])).map(match=>Number(match[1].replace(",","."))*(/^bp/i.test(match[2])?100:10_000)));
  // A continuation such as "project fee is 2%, falling to 1%" retains the
  // component until a new fee label or sentence changes its subject.
  for(const match of text.matchAll(new RegExp(label,"giu"))){
    const remainder=text.slice(match.index!+match[0].length).split(/(?<!\d)[.!?;\n]|\b(?:platform|total|project|additional)\b|(?:plattform|gesamt|projekt)geb/iu)[0].slice(0,180);
    if(negated(remainder))continue;
    for(const rate of remainder.matchAll(new RegExp(number,"giu")))rates.push(Number(rate[1].replace(",","."))*(/^bp/i.test(rate[2])?100:10_000));
  }
  return rates;
}

/** A named project component cannot also be called the total. Only flag an
 * explicit contradictory label, leaving unlabelled conversational rates alone. */
export function hasConflictingFeeMeaning(texts:readonly string[],reply:string):boolean {
  const project=texts.flatMap(text=>labelledRates(text,"project"));
  const total=texts.flatMap(text=>labelledRates(text,"total"));
  return labelledRates(reply,"total").some(rate=>project.includes(rate)&&!total.includes(rate));
}

/** Only a requested policy minimum may be inferred from platform data. An
 * explicitly chosen numeric endpoint remains the user's economic decision. */
export function hasInventedFeeFloor(texts:readonly string[],userText:string,ratePpm:number):boolean {
  if(!/\b(?:lowest|minimum|minimal|niedrigst\w*)\b[^.!?\n]{0,45}(?:fee|geb[uü]hr)/iu.test(userText))return false;
  if(/\b(?:to|auf)\s+\d+(?:[.,]\d+)?\s*%/iu.test(userText))return false;
  return texts.filter(text=>/\btotal\b|gesamtgeb[uü]hr/iu.test(text)).some(text=>
    [...text.matchAll(/\b(?:fall\w*|drop\w*|declin\w*|decreas\w*|sink\w*|fällt)\b[^.!?\n]{0,90}?\b(?:to|auf)\s+(\d+(?:[.,]\d+)?)\s*%/giu)]
      .some(match=>Number(match[1].replace(",","."))*10_000!==ratePpm));
}
