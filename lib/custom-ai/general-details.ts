import {coinPresentationIssue,parseCoinSetupPatch,type CoinSetup} from "./coin-setup";

export type GeneralDetailField="name"|"symbol"|"image"|"initialBuy"|"description"|"website"|"x"|"socialPost";
/** One actionable detail for both the editor and server admission. This only
 * checks supplied presentation data; it grants no source or launch readiness. */
export function generalLaunchDetailIssue(settings:CoinSetup,hasImage:boolean,route:"graph"|"plan"=settings.chainId===4663?"plan":"graph"):{field:GeneralDetailField;message:string}|null {
  if(!settings.name.trim())return{field:"name",message:"Add the coin name before preparing it."};
  if(!settings.symbol.trim())return{field:"symbol",message:"Add the ticker before preparing it."};
  if(!hasImage)return{field:"image",message:"Choose the saved coin image before preparing it."};
  for(const field of ["name","symbol","initialBuy"] as const){
    try{parseCoinSetupPatch({[field]:settings[field]});}
    catch(error){return{field,message:error instanceof Error?error.message:"Check this coin detail before preparing it."};}
  }
  for(const field of ["description","website","x","socialPost"] as const){
    if(route==="plan"&&!settings[field]?.trim())continue;
    const message=coinPresentationIssue(settings,field);if(message)return{field,message};
  }
  if(route==="plan"&&!settings.website?.trim()&&!settings.x?.trim()&&!settings.socialPost?.trim())return{field:"website",message:"Add a public project or social link before preparing this launch."};
  return null;
}
