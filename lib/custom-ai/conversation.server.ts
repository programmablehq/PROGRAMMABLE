import "server-only";
import { createHash } from "node:crypto";
import type { AIConnection } from "./store.server";
import { CustomAIError, type ChatRequest } from "./types";
import { LEGACY_CONVERSATION, conversationTitle, validConversationId, type Conversation, type ConversationItem, type ConversationPage } from "./conversation";
import type { StudioState } from "./studio";

type Transaction = <T>(work: (db: AIConnection) => Promise<T>) => Promise<T>;
export function conversationStorageId(account: string, id = LEGACY_CONVERSATION) {
  if (!/^0x[0-9a-f]{40}$/i.test(account) || !validConversationId(id)) throw new CustomAIError("conversation", "Choose a saved chat.");
  return createHash("sha256").update(account.toLowerCase() + (id === LEGACY_CONVERSATION ? "" : ":" + id.toLowerCase())).digest("hex");
}
const item = (row: Record<string, unknown>): ConversationItem => ({ ...(row.value as Conversation), revision: Number(row.revision), updatedAt: new Date(String(row.updated_at)).toISOString() });
export function jobMatchesConversation(request: ChatRequest | undefined, account: string, id: string) {
  return request?.conversation ? request.conversation.account.toLowerCase() === account.toLowerCase() && request.conversation.id === id : id === LEGACY_CONVERSATION;
}
export async function bindConversationJob(db: AIConnection, owner: string, request: ChatRequest) {
  const scope = request.conversation;if (!scope) return;
  const id = conversationStorageId(scope.account, scope.id);
  const meta = (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='conversation' AND id=$2 FOR UPDATE", [owner,id])).rows[0]?.value as Conversation | undefined;
  if (!meta || meta.archived) throw new CustomAIError("conversation", "Open this chat before sending another message.", 409);
  const studio = (await db.query("SELECT revision,value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='studio' AND id=$2 FOR UPDATE", [owner,id])).rows[0];
  const state = studio?.value as StudioState | undefined;
  if (Number(studio?.revision ?? 0) !== scope.revision || (state?.draftId ?? "") !== (request.draftId ?? "") || (state?.contextId ?? "") !== (request.contextId ?? "")) {
    throw new CustomAIError("conflict", "This chat changed in another window. Reload it before sending.", 409);
  }
  for (const contextId of new Set([request.draftId,request.contextId].filter((value): value is string => Boolean(value)))) {
    const row = (await db.query("SELECT request FROM programmable_custom_ai_v1.jobs WHERE owner=$1 AND id=$2",[owner,contextId])).rows[0];
    if (!row || !jobMatchesConversation(row.request as ChatRequest,scope.account,scope.id)) throw new CustomAIError("context", "That design belongs to another chat.",409);
  }
  meta.activeRequest=request.id;
  if(!meta.customTitle)meta.title=conversationTitle(request.coin?.name||request.messages.find(m=>m.role==="user")?.content||meta.title);
  await db.query("UPDATE programmable_custom_ai_v1.objects SET value=$3,revision=revision+1,updated_at=now() WHERE owner=$1 AND kind='conversation' AND id=$2",[owner,id,JSON.stringify(meta)]);
}
/** Called inside the same studio CAS transaction; no second financial store. */
export async function updateConversationStudio(db: AIConnection, owner: string, id: string, state: StudioState) {
  const row = (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='conversation' AND id=$2 FOR UPDATE",[owner,id])).rows[0];
  if (!row) return;
  const meta = row.value as Conversation;
  if (meta.archived) throw new CustomAIError("archived", "Restore this chat before editing it.",409);
  for (const contextId of new Set([state.draftId,state.contextId].filter((value): value is string => Boolean(value)))) {
    const job = (await db.query("SELECT request FROM programmable_custom_ai_v1.jobs WHERE owner=$1 AND id=$2",[owner,contextId])).rows[0];
    if (!job || !jobMatchesConversation(job.request as ChatRequest,meta.account,meta.id)) throw new CustomAIError("context", "That design belongs to another chat.",409);
  }
  if (state.contextId === meta.activeRequest) delete meta.activeRequest;
  if (!meta.customTitle) meta.title=conversationTitle(state.settings.name || state.messages.find(m=>m.role==="user")?.content || meta.title);
  await db.query("UPDATE programmable_custom_ai_v1.objects SET value=$3,revision=revision+1,updated_at=now() WHERE owner=$1 AND kind='conversation' AND id=$2",[owner,id,JSON.stringify(meta)]);
}
export function createConversationStore(transaction: Transaction) {
  async function create(owner: string, account: string, chatId: string) {
    if(!validConversationId(chatId))throw new CustomAIError("conversation","Choose a saved chat.");
    chatId=chatId.toLowerCase();
    const id=conversationStorageId(account,chatId);account=account.toLowerCase();
    return transaction(async db=>{
      const existing=(await db.query("SELECT value,revision,updated_at FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='conversation' AND id=$2",[owner,id])).rows[0];
      if(existing)return item(existing);
      const legacy=chatId===LEGACY_CONVERSATION?(await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='studio' AND id=$2",[owner,id])).rows[0]?.value as StudioState|undefined:undefined;
      const value:Conversation={id:chatId,account,title:conversationTitle(legacy?.settings.name||legacy?.messages.find(m=>m.role==="user")?.content||"New coin"),archived:false,createdAt:new Date().toISOString()};
      const rows=(await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES($1,'conversation',$2,$3) ON CONFLICT(owner,kind,id) DO UPDATE SET value=programmable_custom_ai_v1.objects.value RETURNING value,revision,updated_at",[owner,id,JSON.stringify(value)])).rows;
      return item(rows[0]);
    });
  }
  async function read(owner:string,account:string,chatId:string){
    const id=conversationStorageId(account,chatId);
    return transaction(async db=>{const row=(await db.query("SELECT value,revision,updated_at FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='conversation' AND id=$2",[owner,id])).rows[0];return row?item(row):null;});
  }
  async function list(owner:string, account:string, options:{search?:string;archived?:boolean;cursor?:string}={}):Promise<ConversationPage>{
    conversationStorageId(account);let cursor:{at:string;id:string}|undefined;
    if(options.cursor){try{if(options.cursor.length>512)throw Error();cursor=JSON.parse(Buffer.from(options.cursor,"base64url").toString());if(!cursor||!/^\d{4}-/.test(cursor.at)||!Number.isFinite(Date.parse(cursor.at))||!/^[a-f0-9]{64}$/.test(cursor.id))throw Error();}catch{throw new CustomAIError("cursor","Reload the chat list.");}}
    if((options.search?.length??0)>80)throw new CustomAIError("search","Keep the search under 80 characters.");
    const search=(options.search??"").replace(/[\\%_]/g,"\\$&");
    return transaction(async db=>{
      const rows=(await db.query(`SELECT id,value,revision,updated_at,updated_at::text AS cursor_at FROM programmable_custom_ai_v1.objects
        WHERE owner=$1 AND kind='conversation' AND value->>'account'=$2 AND (value->>'archived')::boolean=$3
        AND ($4='' OR value->>'title' ILIKE '%'||$4||'%' ESCAPE '\\')
        AND ($5::timestamptz IS NULL OR (updated_at,id)<($5::timestamptz,$6::text))
        ORDER BY updated_at DESC,id DESC LIMIT 21`,[owner,account.toLowerCase(),options.archived??false,search,cursor?.at??null,cursor?.id??null])).rows;
      const visible=rows.slice(0,20),last=visible.at(-1);
      return {conversations:visible.map(item),...(rows.length>20&&last?{cursor:Buffer.from(JSON.stringify({at:String(last.cursor_at),id:last.id})).toString("base64url")}: {})};
    });
  }
  async function update(owner:string,account:string,chatId:string,revision:number,patch:{title?:string;archived?:boolean}){
    if(!validConversationId(chatId)||patch.title===undefined&&patch.archived===undefined)throw new CustomAIError("conversation","Choose a chat action.");
    const id=conversationStorageId(account,chatId);
    if(!Number.isSafeInteger(revision)||revision<1||typeof patch.title!=="undefined"&&(typeof patch.title!=="string"||!patch.title.trim()||patch.title.length>80)||typeof patch.archived!=="undefined"&&typeof patch.archived!=="boolean")throw new CustomAIError("input","Choose a chat name or archive action.");
    return transaction(async db=>{
      const row=(await db.query("SELECT value,revision FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='conversation' AND id=$2 FOR UPDATE",[owner,id])).rows[0];
      if(!row)throw new CustomAIError("missing","That chat was not found.",404);
      if(Number(row.revision)!==revision)throw new CustomAIError("conflict","This chat changed. Refresh its details and try again.",409);
      const value=row.value as Conversation;
      if(value.activeRequest&&patch.archived){await db.query("UPDATE programmable_custom_ai_v1.jobs SET state='failed',error_code='interrupted',updated_at=now() WHERE owner=$1 AND id=$2 AND state='running' AND created_at<now()-interval '10 minutes'",[owner,value.activeRequest]);const active=(await db.query("SELECT state FROM programmable_custom_ai_v1.jobs WHERE owner=$1 AND id=$2",[owner,value.activeRequest])).rows[0];if(active?.state==="running")throw new CustomAIError("busy","Stop or finish the reply before archiving this chat.",409);}
      if(patch.title!==undefined){value.title=conversationTitle(patch.title);value.customTitle=true;}
      if(patch.archived!==undefined)value.archived=patch.archived;
      return item((await db.query("UPDATE programmable_custom_ai_v1.objects SET value=$3,revision=revision+1,updated_at=now() WHERE owner=$1 AND kind='conversation' AND id=$2 RETURNING value,revision,updated_at",[owner,id,JSON.stringify(value)])).rows[0]);
    });
  }
  return {create,list,read,update};
}
