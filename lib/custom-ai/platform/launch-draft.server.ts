import "server-only";
import {getAddress} from "viem";
import {EMPTY_COIN_SETUP,parseCoinSetupPatch,type CoinSetup} from "../coin-setup";
import type {ImageReceipt} from "../studio";
import type {AIPool,AIConnection} from "../store.server";
import {projectTransaction} from "./transaction.server";
import {ProjectError,type ProjectScope} from "./types";
import {canonicalProjectJSON} from "./document";
import {builderChains,type BuilderChainId} from "../execution-routing";

export type PlatformLaunchDraft={revision:number;sourceRevision:string;account:string;settings:CoinSetup;image?:ImageReceipt};
const accountKey=(value:string)=>{try{return getAddress(value).toLowerCase();}catch{throw new ProjectError("launch-wallet","Choose a linked launch wallet.");}};
export function createPlatformLaunchDrafts(pool:AIPool){
  async function source(db:AIConnection,scope:ProjectScope,lock=false){
    const row=(await db.query(`SELECT p.current_revision,r.document FROM programmable_projects_v1.projects p JOIN programmable_projects_v1.revisions r ON r.owner=p.owner AND r.project_id=p.id AND r.id=p.current_revision WHERE p.owner=$1 AND p.id=$2${lock?" FOR UPDATE OF p":""}`,[scope.ownerId,scope.projectId])).rows[0];
    if(!row)throw new ProjectError("project-missing","This project was not found.",404);
    const architecture=(row.document as {architecture?:{chainId?:number}}).architecture;
    if(!architecture||!builderChains.some(chain=>chain.id===Number(architecture.chainId)))throw new ProjectError("launch-contract","Choose a saved contract project first.",409);
    return {revision:String(row.current_revision),chainId:Number(architecture.chainId) as BuilderChainId};
  }
  function view(account:string,current:{revision:string;chainId:BuilderChainId},row?:Record<string,unknown>):PlatformLaunchDraft{
    return {revision:row?Number(row.revision):0,sourceRevision:row?String(row.source_revision):current.revision,account,
      settings:row?row.settings as CoinSetup:{...EMPTY_COIN_SETUP,chainId:current.chainId},...(row?.image?{image:row.image as ImageReceipt}:{})};
  }
  async function read(scope:ProjectScope,account:string){const wallet=accountKey(account);return projectTransaction(pool,scope,async db=>{
    const current=await source(db,scope),row=(await db.query("SELECT * FROM programmable_projects_v1.launch_drafts WHERE owner=$1 AND project_id=$2 AND account=$3",[scope.ownerId,scope.projectId,wallet])).rows[0];return view(wallet,current,row);
  });}
  async function save(scope:ProjectScope,input:{account:string;expectedRevision:number;sourceRevision:string;settings:unknown;imageId?:string|null}){
    const wallet=accountKey(input.account);
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw new ProjectError("launch-draft-input","Use the current launch details.");
    let patch;try{patch=parseCoinSetupPatch(input.settings);}catch{throw new ProjectError("launch-draft-input","Use valid coin details.");}
    return projectTransaction(pool,scope,async db=>{
      const current=await source(db,scope,true);
      if(current.revision!==input.sourceRevision)throw new ProjectError("launch-source-changed","The project changed. Review its current source before saving launch details.",409);
      const row=(await db.query("SELECT * FROM programmable_projects_v1.launch_drafts WHERE owner=$1 AND project_id=$2 AND account=$3 FOR UPDATE",[scope.ownerId,scope.projectId,wallet])).rows[0],previous=view(wallet,current,row);
      if(previous.revision!==input.expectedRevision)throw new ProjectError("launch-draft-conflict","Launch details changed in another session. Reload before editing.",409);
      const settings={...previous.settings,...patch};if(settings.chainId!==current.chainId)throw new ProjectError("launch-chain","Keep launch details on the saved contract chain.",409);
      let image=previous.image;
      if(input.imageId===null)image=undefined;
      else if(input.imageId!==undefined){
        if(!/^[a-f0-9]{64}$/.test(input.imageId))throw new ProjectError("launch-image","Choose your saved coin image.");
        const receipt=(await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='image' AND id=$2",[scope.ownerId,input.imageId])).rows[0]?.value as ImageReceipt|undefined;
        if(!receipt||receipt.id!==input.imageId||!/^[a-f0-9]{64}$/.test(receipt.hash)||typeof receipt.url!=="string")throw new ProjectError("launch-image","Choose a coin image uploaded by this account.",404);
        image=receipt;
      }
      if(previous.revision>0&&previous.sourceRevision===current.revision&&canonicalProjectJSON(previous.settings)===canonicalProjectJSON(settings)&&canonicalProjectJSON(previous.image??null)===canonicalProjectJSON(image??null))return previous;
      const saved=(await db.query("INSERT INTO programmable_projects_v1.launch_drafts(owner,project_id,account,revision,source_revision,settings,image,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,now()) ON CONFLICT(owner,project_id,account) DO UPDATE SET revision=$4,source_revision=$5,settings=$6::jsonb,image=$7::jsonb,updated_at=now() RETURNING *",[scope.ownerId,scope.projectId,wallet,previous.revision+1,current.revision,JSON.stringify(settings),image?JSON.stringify(image):null])).rows[0];
      return view(wallet,current,saved);
    });
  }
  return {read,save};
}
