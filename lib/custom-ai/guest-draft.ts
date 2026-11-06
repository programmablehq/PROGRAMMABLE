import {parseChatRequest} from "./types";

// Guest input stays in this tab only. It never becomes an owned chat without
// the existing explicit sign-in handoff, and expires after a day.
const key="programmable.custom-ai.guest-input.v1";
const lifetime=24*60*60_000;
type DraftStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
function checkedText(text:unknown):string {
  if(typeof text!=="string")throw new TypeError("Invalid guest input");
  parseChatRequest({id:"guest-draft-input",intent:"chat",messages:[{role:"user",content:text}]});
  return text;
}
export function readGuestDraft(storage?:DraftStorage,now=Date.now()):string {
  try {
    const target=storage??window.sessionStorage,raw=target.getItem(key);
    if(!raw)return "";
    const value=JSON.parse(raw);
    if(value?.version!==1||!Number.isSafeInteger(value.savedAt)||value.savedAt>now||now-value.savedAt>=lifetime)throw new TypeError("Expired guest input");
    return checkedText(value.text);
  }catch{return "";}
}
export function writeGuestDraft(text:string,storage?:DraftStorage,now=Date.now()):void {
  try {
    const target=storage??window.sessionStorage;
    if(!text.trim()){target.removeItem(key);return;}
    target.setItem(key,JSON.stringify({version:1,text:checkedText(text),savedAt:now}));
  }catch{clearGuestDraft(storage);}
}
export function clearGuestDraft(storage?:DraftStorage):void {
  try{(storage??window.sessionStorage).removeItem(key);}catch{/* Storage may be disabled; editing still works. */}
}
