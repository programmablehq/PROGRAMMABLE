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
  return texts.some(text=>text.split(/(?<!\d)[.!?;\n]\s*/u).some(sentence=>
    [...sentence.matchAll(/\b(?:fall\w*|drop\w*|declin\w*|decreas\w*|sink\w*|fällt)\b[^.!?\n]{0,90}?\b(?:to|auf)\s+(\d+(?:[.,]\d+)?)\s*%/giu)]
      .some(match=>{
        const prefix=sentence.slice(0,match.index);
        const subjects=[...prefix.matchAll(/\b(?:total(?:\s+swap)?\s+(?:fees?|tax)|gesamtgeb[uü]hr\w*|(?:project|additional|platform)(?:\s+swap)?\s+fees?|(?:projekt|plattform)geb[uü]hr\w*)/giu)];
        const subject=subjects.at(-1)?.[0]??"";
        return /^(?:total|gesamt)/iu.test(subject)&&Number(match[1].replace(",","."))*10_000!==ratePpm;
      })));
}

/** Settle only explicit fee-component ambiguities and numerically identical
 * terminal choices. Other economic questions remain with their owning rule. */
export function resolvedFeeQuestion(question:string,userText:string,ratePpm?:number):boolean {
  if(/["„“”`]|^\s*>/u.test(question))return false;
  if(!/\b(?:or|oder|whether|ob)\b/iu.test(question))return false;
  const user= userText.replace(/```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"|„[^“\n]*“|“[^”\n]*”/g," ");
  if(/\b(?:remain\w*|stay\w*|bleib\w*)\b/iu.test(question)&&/\b(?:chang\w*|veränder\w*|verändert|verändern|änder\w*)\b/iu.test(question)
    &&/\b(?:after|afterwards|end|nach|ende)\b/iu.test(question)
    &&/(?:\b(?:fees?|tax|(?:gesamt|projekt)?geb[uü]hr\w*)\b|%)/iu.test(question)
    &&/\b(?:linear|ramp|fällt|fall\w*|sink\w*)\b/iu.test(user)&&/(?:\d+(?:[.,]\d+)?\s*%|minimum)/iu.test(user)
    &&!/\b(?:undecided|unsure|uncertain|offen|unklar)\b|weiß nicht/iu.test(user))return true;
  const ambiguity=/(?:total(?:\s+fee)?|gesamt(?:geb[uü]hr)?-?)\s+(?:or|oder)\s+(?:(?:an?|the|eine?)\s+)?(?:project|additional|extra|projekt|zusatz)/iu.test(question)
    ||/(?:project|additional|projekt|zusatz)(?:\s+fee|geb[uü]hr)?\s+(?:or|oder)\s+(?:total|gesamt)/iu.test(question);
  if(ambiguity&&(labelledRates(user,"total").length>0||labelledRates(user,"project").length>0))return true;
  if(ratePpm===undefined||!/\b(?:(?:plattform|platform)?minimum|minimal\w*|floor|untergrenze)\b/iu.test(user))return false;
  const labels=[...question.matchAll(/\b(?:total(?:\s+swap)?\s+fees?|gesamtgeb[uü]hr\w*|(?:project|additional)(?:\s+swap)?\s+fees?|projektgeb[uü]hr\w*)/giu)];
  const amounts={total:[] as number[],project:[] as number[]};
  for(const [index,label] of labels.entries()){
    const span=question.slice(label.index!+label[0].length,labels[index+1]?.index);
    const rate=span.match(/(\d+(?:[.,]\d+)?)\s*%/u);
    if(rate)amounts[/^(?:total|gesamt)/iu.test(label[0])?"total":"project"].push(Number(rate[1].replace(",","."))*10000);
  }
  const {total,project}=amounts;
  return total.length>0&&project.length>0&&total.every(rate=>rate===ratePpm)&&project.every(rate=>rate===0);
}

export function settleFeeChoices(value:Record<string,unknown>,userText:string,ratePpm?:number,previousIds:readonly string[]=[]):Record<string,unknown> {
  if(!Array.isArray(value.intentRequirements))return value;
  let changed=false;
  const rules=value.intentRequirements.flatMap((rule:unknown)=>{
    if(!rule||typeof rule!=="object")return [rule];
    const item=rule as Record<string,unknown>;
    if(typeof item.open!=="string"||!resolvedFeeQuestion(item.open,userText,ratePpm))return [rule];
    changed=true;
    if(item.text===item.open&&!previousIds.includes(String(item.id)))return [];
    return [{...item,open:null,...(previousIds.includes(String(item.id))?{instruction:userText}:{})}];
  });
  if(!changed)return value;
  const reply=typeof value.reply==="string"?value.reply.split(/(?<=[.!?])\s+/u)
    .filter(sentence=>!resolvedFeeQuestion(sentence,userText,ratePpm)).join(" "):value.reply;
  return {...value,intentRequirements:rules,reply:reply||(/\b(?:geb[uü]hr|soll|entwurf)\b/iu.test(userText)?"Die Gebührenregel ist festgelegt.":"The fee rule is settled.")};
}
