import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { getAddress, getContractAddress, keccak256, type Address } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2, fileSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { AIConnection } from "./store.server";
import type { GeneralLaunchSourceSelection } from "./general-launch-source.server";
import type { GeneralPackIdentity } from "./general-pack-config.server";
import type { packGeneralGraph } from "./general-pack.server";
import type { packGeneralRobinhoodPlan } from "./general-plan-pack.server";
import { createGeneralPublicSource, type OwnedGeneralLaunchSource } from "./public-launch-source.server";
import { CustomAIError } from "./types";
import { generalLaunchDetailIssue } from "./general-details";
import type { CoinSetup } from "./coin-setup";

export type GeneralPackedLaunch = Awaited<ReturnType<typeof packGeneralGraph>> | Awaited<ReturnType<typeof packGeneralRobinhoodPlan>>;
export type GeneralExchangeOperation = "preflight" | "create";
export type GeneralExchange = {
  state: "sending" | "unknown" | "rejected" | "completed";
  lease: string; until: number; attempts: number;
  httpStatus?: number; code?: string; disposition?: string; findingCodes?: string[];
  resourceId?: string; backendState?: string;
};
export type GeneralPreparation = {
  version: 1; id: string; account: Address; chainId: OwnedGeneralLaunchSource["project"]["chainId"];
  selection: GeneralLaunchSourceSelection; bindingHash: `sha256:${string}`; productionId: `sha256:${string}`;
  inputHash: `sha256:${string}`; identity: GeneralPackIdentity; idempotencyKey: string;
  nativeFundingWei?: string; createdAt: number; updatedAt: number;
  controllerKind?: "eoa"; manifestDigest?: `sha256:${string}`;
  coin?: {name:string;symbol:string};
  editor?: {settings:CoinSetup;imageId:string};
  packState: "packing" | "failed" | "complete";
  packLease: { token: string; until: number; slot: number };
  packCode?: string; packHash?: `sha256:${string}`; requestSha256?: `sha256:${string}`; requestHash?: `sha256:${string}`;
  publicSourceId?: `sha256:${string}`; launchProfileHash?: string; launchIntentHash?: string;
  preflight?: GeneralExchange; submission?: GeneralExchange;
};
export type GeneralExchangeSummary = Pick<GeneralExchange, "httpStatus" | "code" | "disposition" | "findingCodes" | "resourceId" | "backendState">;
type Transaction = <T>(work: (connection: AIConnection) => Promise<T>) => Promise<T>;
type Sources = {
  read(db: AIConnection, owner: string, selection: GeneralLaunchSourceSelection): Promise<OwnedGeneralLaunchSource>;
  publish(db: AIConnection, source: OwnedGeneralLaunchSource): Promise<void>;
};
const KIND = "general-prepare", PACK_KIND = "general-launch-pack", REPLY_KIND = "general-launch-reply";
const CAPACITY = 2, PACK_LEASE_MS = 120_000, SEND_LEASE_MS = 130_000;
const validId = (id: string) => typeof id === "string" && /^[A-Za-z0-9-]{16,64}$/u.test(id);
const conflict = () => new CustomAIError("launch-preparation-changed", "Open the saved launch preparation before continuing.", 409);
const busy = () => new CustomAIError("launch-preparation-busy", "Launch preparation is already running. Your saved request is kept.", 429, 5000);
const corrupt = () => new CustomAIError("launch-preparation-storage", "The saved launch needs recovery before continuing. Its original request is kept.", 503);
const slotId = (slot: number) => `custom-ai-pack-slot-${slot}`;
const pointerId = (account: string) => fileSha256V2(Buffer.from(account.toLowerCase())).slice(7);
const exchangeKey = (operation: GeneralExchangeOperation) => operation === "create" ? "submission" : "preflight";
function validRecord(value: unknown, id: string): GeneralPreparation {
  const v = value as GeneralPreparation | undefined;
  if (!v || v.version !== 1 || v.id !== id || !validId(id) || !/^0x[a-f0-9]{40}$/iu.test(v.account)
    || ![1,4663,8453,999].includes(v.chainId) || !v.identity || !v.packLease || !v.selection
    || !["packing","failed","complete"].includes(v.packState)) throw corrupt();
  return v;
}
function exactPack(pack: GeneralPackedLaunch, record: GeneralPreparation) {
  const { hash, ...body } = pack;
  if (Buffer.byteLength(JSON.stringify(pack)) > 24_000_000 || ![1,2].includes(pack.version)
    || pack.route !== (record.chainId===4663?"plan-v1":"graph-v3") || pack.chainId !== record.chainId || pack.bindingHash !== record.bindingHash
    || pack.productionId !== record.productionId || pack.launchReady !== false
    || pack.projectHash !== record.selection.projectHash || pack.artifactHash !== record.selection.artifactHash
    || canonicalBrowserSha256V2(`programmable.custom-ai-general-${pack.route==="plan-v1"?"plan":"graph"}-pack.v${pack.version}`, body) !== hash
    || canonicalBrowserSha256V2("programmable.custom-ai-pack-identity.v1", pack.identity)
      !== canonicalBrowserSha256V2("programmable.custom-ai-pack-identity.v1", record.identity)
    || typeof pack.requestBody !== "string" || Buffer.byteLength(pack.requestBody) > (record.chainId===4663?16_777_216:8_388_608)
    || fileSha256V2(Buffer.from(pack.requestBody)) !== pack.requestSha256) throw corrupt();
  const construction=pack.route==="plan-v1"?pack.runtimeMaterialization:pack.constructorMaterialization;
  if(pack.version===1&&(pack.route==="plan-v1"?construction?.version!==1:construction!==undefined))throw corrupt();
  if(pack.version===2) {
    const runtime=construction;
    if(!runtime||runtime.version!==2||runtime.scope!=="isolated-constructor-runtime-v2"||runtime.status!=="materialized"||runtime.launchReady!==false
      ||runtime.projectHash!==pack.projectHash||runtime.artifactHash!==pack.artifactHash||runtime.productionId!==pack.productionId
      ||runtime.chainId!==pack.chainId||typeof runtime.controller!=="string"||runtime.controller.toLowerCase()!==record.account.toLowerCase()
      ||runtime.passes!==2||!Array.isArray(runtime.failures)||runtime.failures.length||!Array.isArray(runtime.contracts)||!Array.isArray(runtime.targets)
      ||!Array.isArray(runtime.children)||!runtime.children.length||!Array.isArray(runtime.constructorChildren)||runtime.children.length!==runtime.constructorChildren.length
      ||runtime.targets.length+runtime.children.length>16||runtime.contracts.length!==runtime.targets.length
      ||runtime.targets.some(target=>!target||typeof target.id!=="string"||typeof target.address!=="string"||!/^0x[a-f0-9]{40}$/iu.test(target.address)))throw corrupt();
    const {hash:runtimeHash,...runtimeBody}=runtime;
    if(canonicalBrowserSha256V2("programmable.custom-ai-runtime-materialization.v2",runtimeBody)!==runtimeHash)throw corrupt();
    const addresses=new Map(runtime.targets.map(target=>[target.id,target.address])),ids=new Set(addresses.keys()),nonces=new Map<string,bigint>();
    if(ids.size!==runtime.targets.length||new Set(runtime.children.map(child=>child.id)).size!==runtime.children.length)throw corrupt();
    for(const child of runtime.constructorChildren) {
      const parent=addresses.get(child.parent),actual=runtime.children.find(observed=>observed.id===child.id);
      if(!parent||ids.has(child.id)||typeof child.nonce!=="string"||!/^[1-9][0-9]?$/.test(child.nonce)||BigInt(child.nonce)!==(nonces.get(child.parent)??1n)
        ||getContractAddress({from:parent,nonce:BigInt(child.nonce)})!==child.address||!actual||actual.address!==child.address||actual.parent!==child.parent||actual.nonce!==child.nonce
        ||typeof actual.runtimeCode!=="string"||!/^0x(?:[a-f0-9]{2})+$/u.test(actual.runtimeCode)||keccak256(actual.runtimeCode)!==actual.runtimeCodeHash)throw corrupt();
      ids.add(child.id);addresses.set(child.id,child.address);nonces.set(child.parent,BigInt(child.nonce)+1n);
    }
    if(pack.route==="plan-v1"&&pack.receipt.runtimeMaterializationHash!==runtime.hash)throw corrupt();
  }
  const request = JSON.parse(pack.requestBody);
  if(pack.route==="plan-v1") {
    const requestHash=canonicalBrowserSha256V2("programmable.custom-launch-plan.v1",request);
    if(record.chainId!==4663 || record.controllerKind!=="eoa" || !record.manifestDigest
      || request.schemaVersion!=="programmable.custom-launch-plan.v1" || request.chainId!=="4663"
      || request.controller?.address?.toLowerCase()!==record.account.toLowerCase() || request.controller.kind!==record.controllerKind
      || request.manifestDigest!==record.manifestDigest || request.executor!=="atomic_execute_and_stamp_v2"
      || request.budgets?.validAfter!==record.identity.validAfter || request.budgets.deadline!==record.identity.deadline
      || requestHash!==pack.planHash || pack.requestBody!==canonicalBrowserJsonV2(request))throw corrupt();
    return {requestHash};
  }
  if (request.schemaVersion !== "programmable.custom-launch-create-request.v3" || request.chainId !== String(record.chainId)
    || request.launchWallet?.toLowerCase() !== record.account.toLowerCase() || request.nonce !== record.identity.nonce
    || request.permitWindow?.validAfter !== record.identity.validAfter || request.permitWindow.deadline !== record.identity.deadline
    || !/^sha256:[a-f0-9]{64}$/u.test(request.launchProfileHash) || !/^sha256:[a-f0-9]{64}$/u.test(request.launchIntentHash)) throw corrupt();
  return { requestHash: canonicalBrowserSha256V2(request.schemaVersion, request),
    launchProfileHash: request.launchProfileHash as string, launchIntentHash: request.launchIntentHash as string };
}

/** Short database transactions only. The existing object/budget tables and
 * runtime role are reused; no compiler, network, signing or model runs here. */
export function createGeneralPreparationStore(transaction: Transaction, sources: Sources, now: () => number) {
  async function readIn(db: AIConnection, owner: string, id: string, lock = false) {
    if (!validId(id)) throw conflict();
    const row = (await db.query(`SELECT value FROM programmable_custom_ai_v1.objects
      WHERE owner=$1 AND kind=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [owner,KIND,id])).rows[0];
    return row ? validRecord(row.value,id) : null;
  }
  async function write(db: AIConnection, owner: string, record: GeneralPreparation) {
    record.updatedAt = now();
    await db.query(`UPDATE programmable_custom_ai_v1.objects SET value=$4,revision=revision+1,updated_at=now()
      WHERE owner=$1 AND kind=$2 AND id=$3`, [owner,KIND,record.id,JSON.stringify(record)]);
    return record;
  }
  async function charge(db: AIConnection, subject: string, maximum: number) {
    const row = await db.query(`INSERT INTO programmable_custom_ai_v1.budgets(subject,period,used) VALUES($1,$2,1)
      ON CONFLICT(subject,period) DO UPDATE SET used=programmable_custom_ai_v1.budgets.used+1
      WHERE programmable_custom_ai_v1.budgets.used < $3 RETURNING used`, [subject,Math.floor(now()/3_600_000),maximum]);
    if (!row.rows.length) throw new CustomAIError("launch-preparation-budget", "The preparation request limit has been reached. Your saved requests are kept.", 429,
      3_600_000-now()%3_600_000);
  }
  async function capacity(db: AIConnection, owner: string) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('custom-ai-general-pack-capacity',0))");
    // Two fixed rows avoid scanning private source objects to count workers.
    const slots = (await db.query(`SELECT id,value FROM programmable_custom_ai_v1.objects
      WHERE owner='system' AND kind='general-pack-slot' AND id=ANY($1::text[]) FOR UPDATE`,
    [Array.from({length:CAPACITY},(_,slot)=>slotId(slot))])).rows;
    const slot = Array.from({length:CAPACITY},(_,index)=>index).find(index => {
      const prior = slots.find(row=>row.id===slotId(index));
      return !prior || Number((prior.value as { until: number }).until) <= now();
    });
    if (slot === undefined) throw busy();
    await charge(db,`operation:general-pack:${owner}`,6);
    await charge(db,"operation:general-pack:global",60);
    const lease = { token: randomUUID(), until: now()+PACK_LEASE_MS, slot };
    await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value)
      VALUES('system','general-pack-slot',$1,$2) ON CONFLICT(owner,kind,id)
      DO UPDATE SET value=$2,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()`, [slotId(slot),JSON.stringify(lease)]);
    return lease;
  }
  async function release(db: AIConnection, lease: GeneralPreparation["packLease"]) {
    await db.query(`UPDATE programmable_custom_ai_v1.objects SET value=jsonb_set(value,'{until}','0'::jsonb),updated_at=now()
      WHERE owner='system' AND kind='general-pack-slot' AND id=$1 AND value->>'token'=$2`, [slotId(lease.slot),lease.token]);
  }
  function withinWindow(record: GeneralPreparation) {
    if (BigInt(Math.floor(now()/1000)) >= BigInt(record.identity.deadline))
      throw new CustomAIError("launch-preparation-expired", "This preparation expired. Keep any submitted request and check its status before starting another.", 409);
  }
  async function revalidate(db: AIConnection, owner: string, record: GeneralPreparation) {
    const source = await sources.read(db,owner,record.selection);
    if (source.bindingHash !== record.bindingHash || source.project.production?.id !== record.productionId) throw conflict();
    return source;
  }
  async function readPackIn(db: AIConnection, owner: string, record: GeneralPreparation) {
    const row = (await db.query(`SELECT value FROM programmable_custom_ai_v1.objects
      WHERE owner=$1 AND kind=$2 AND id=$3`,[owner,PACK_KIND,record.id])).rows[0];
    if (!row) throw corrupt();
    const pack = row.value as GeneralPackedLaunch, identity = exactPack(pack,record);
    if (pack.hash !== record.packHash || pack.requestSha256 !== record.requestSha256 || identity.requestHash !== record.requestHash) throw corrupt();
    return pack;
  }
  return {
    read: (owner: string,id: string) => transaction(db=>readIn(db,owner,id)),
    active: (owner: string,account: string) => transaction(async db=>{
      const row=(await db.query(`SELECT value->>'id' AS id FROM programmable_custom_ai_v1.objects
        WHERE owner=$1 AND kind='active-general-prepare' AND id=$2`,[owner,pointerId(getAddress(account))])).rows[0];
      return row ? readIn(db,owner,String(row.id)) : null;
    }),
    async reserve(owner: string,id: string,selection: GeneralLaunchSourceSelection,nativeFundingWei?: string,controllerKind?:"eoa") {
      if (!validId(id) || nativeFundingWei !== undefined && (!/^(?:0|[1-9][0-9]{0,77})$/u.test(nativeFundingWei) || BigInt(nativeFundingWei)>=2n**256n)) throw conflict();
      selection=structuredClone(selection);
      return transaction(async db=>{
        // Preserve the conversation/studio lock order before taking a launch
        // lock. A background pack cannot freeze chat editing for its duration.
        const source=await sources.read(db,owner,selection), account=getAddress(source.binding.account), production=source.project.production;
        if (!production || ![2,3].includes(production.version)) throw conflict();
        if(source.project.chainId===4663 ? controllerKind!=="eoa" || !production.manifestDigest : controllerKind!==undefined)throw conflict();
        const issue=generalLaunchDetailIssue(source.binding.settings,Boolean(source.binding.image));
        if(issue)throw new CustomAIError("launch-details",issue.message,422);
        const bound={...selection,bindingHash:source.bindingHash};
        const inputHash=canonicalBrowserSha256V2("programmable.custom-ai-general-prepare-input.v1",{bindingHash:source.bindingHash,nativeFundingWei:nativeFundingWei??null,
          ...(source.project.chainId===4663?{controllerKind}: {})});
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`custom-ai-general-launch:${owner}:${account.toLowerCase()}`]);
        let previous=await readIn(db,owner,id,true);
        if (previous && previous.inputHash!==inputHash) throw conflict();
        if (!previous) {
          const active=(await db.query(`SELECT value->>'id' AS id FROM programmable_custom_ai_v1.objects
            WHERE owner=$1 AND kind='active-general-prepare' AND id=$2`,[owner,pointerId(account)])).rows[0];
          const prior=active?await readIn(db,owner,String(active.id),true):null;
          if (prior?.inputHash===inputHash && (prior.submission || prior.packState!=="failed" && BigInt(prior.identity.deadline)>BigInt(Math.floor(now()/1000)))) previous=prior;
          else if (prior?.submission && prior.submission.state!=="completed" || prior?.packState==="packing" && prior.packLease.until>now()) throw conflict();
        }
        if (previous) {
          if (previous.packState==="complete" || previous.packState==="packing" && previous.packLease.until>now()) return {record:previous,lease:null,source:null};
          withinWindow(previous);
          previous.packLease=await capacity(db,owner);previous.packState="packing";delete previous.packCode;
          return {record:await write(db,owner,previous),lease:previous.packLease.token,source};
        }
        const time=now(), seconds=Math.floor(time/1000), nonce=`0x${randomBytes(32).toString("hex")}` as const;
        const record:GeneralPreparation={version:1,id,account,chainId:source.project.chainId,selection:bound,bindingHash:source.bindingHash,
          productionId:production.id,inputHash,identity:{nonce,sourceLineageNonce:BigInt(nonce).toString(),validAfter:String(Math.max(0,seconds-30)),
            deadline:String(seconds+1800),checkedAt:new Date(time).toISOString()},idempotencyKey:`custom-ai-${randomUUID()}`,
          ...(nativeFundingWei===undefined?{}:{nativeFundingWei}),coin:{name:source.binding.settings.name,symbol:source.binding.settings.symbol},
          editor:{settings:structuredClone(source.binding.settings),imageId:source.binding.image!.id},
          createdAt:time,updatedAt:time,packState:"packing",packLease:await capacity(db,owner)};
        if(source.project.chainId===4663){record.controllerKind=controllerKind;record.manifestDigest=production.manifestDigest!;}
        await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES($1,$2,$3,$4)",[owner,KIND,id,JSON.stringify(record)]);
        await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES($1,'active-general-prepare',$2,$3)
          ON CONFLICT(owner,kind,id) DO UPDATE SET value=$3,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()`,[owner,pointerId(account),JSON.stringify({id})]);
        return {record,lease:record.packLease.token,source};
      });
    },
    async completePack(owner: string,id: string,lease: string,candidate: GeneralPackedLaunch) {
      const pack=structuredClone(candidate);
      return transaction(async db=>{
        const initial=await readIn(db,owner,id);if(!initial)throw conflict();
        const source=await revalidate(db,owner,initial), record=await readIn(db,owner,id,true);if(!record)throw conflict();
        if(record.packState==="complete"){if(record.packHash!==pack.hash)throw conflict();return record;}
        if(record.packState!=="packing" || record.packLease.token!==lease || record.packLease.until<=now())throw conflict();
        withinWindow(record);
        const identity=exactPack(pack,record), exported=createGeneralPublicSource(source);
        if(pack.publicSourceId!==exported.id)throw conflict();
        // Publish the sanitized export and save the final exact bytes together,
        // only after the explicitly selected owned source still matches.
        await sources.publish(db,source);
        await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES($1,$2,$3,$4)",[owner,PACK_KIND,id,JSON.stringify(pack)]);
        Object.assign(record,identity,{packState:"complete",packHash:pack.hash,requestSha256:pack.requestSha256,publicSourceId:pack.publicSourceId});
        await release(db,record.packLease);return write(db,owner,record);
      });
    },
    failPack: (owner: string,id: string,lease: string,code: string) => transaction(async db=>{
      const record=await readIn(db,owner,id,true);
      if(!record || record.packState!=="packing" || record.packLease.token!==lease)return;
      record.packState="failed";record.packCode=/^[a-zA-Z0-9_-]{1,96}$/u.test(code)?code:"launch-pack-worker";
      await release(db,record.packLease);await write(db,owner,record);
    }),
    async claimExchange(owner: string,id: string,operation: GeneralExchangeOperation,productionId: string) {
      return transaction(async db=>{
        const initial=await readIn(db,owner,id);if(!initial)throw conflict();
        // First submission binds the current chat. Recovery explicitly uses
        // the already sealed original ticket, even if the chat was later
        // edited or archived. It can only replay the saved exact body/key.
        if(!initial.submission)await revalidate(db,owner,initial);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`custom-ai-general-launch:${owner}:${initial.account.toLowerCase()}`]);
        const record=await readIn(db,owner,id,true);if(!record || record.packState!=="complete" || record.productionId!==productionId)throw conflict();
        const active=(await db.query(`SELECT value->>'id' AS id FROM programmable_custom_ai_v1.objects
          WHERE owner=$1 AND kind='active-general-prepare' AND id=$2`,[owner,pointerId(record.account)])).rows[0];
        if(active?.id!==id)throw conflict();
        const key=exchangeKey(operation), previous=record[key];
        if(previous?.state==="completed")return {record,lease:null,pack:null};
        if(previous?.state==="sending" && previous.until>now())return {record,lease:null,pack:null};
        if(record.submission && operation==="preflight")throw conflict();
        // A create retry recovers the original identity even after expiry. It
        // can never allocate a fresh window, source, nonce or idempotency key.
        if(!record.submission)withinWindow(record);
        // Create enters the existing durable review/lifecycle pipeline. A
        // separate preflight is optional; it confers no additional authority.
        // The backend repeats its own canonical admission before any permit.
        const pack=await readPackIn(db,owner,record);
        await charge(db,`operation:general-launch-${operation}:${owner}`,operation==="create"?12:20);
        const exchange:GeneralExchange={state:"sending",lease:randomUUID(),until:now()+SEND_LEASE_MS,attempts:(previous?.attempts??0)+1};
        record[key]=exchange;await write(db,owner,record);
        return {record,lease:exchange.lease,pack};
      });
    },
    async finishExchange(owner: string,id: string,operation: GeneralExchangeOperation,lease: string,
      outcome: {state:"completed";summary:GeneralExchangeSummary;reply:unknown}|{state:"unknown"|"rejected";summary:GeneralExchangeSummary}) {
      outcome=structuredClone(outcome);
      return transaction(async db=>{
        const record=await readIn(db,owner,id,true), key=exchangeKey(operation), exchange=record?.[key];
        if(!record || !exchange || exchange.lease!==lease || exchange.state!=="sending")throw conflict();
        const summary=outcome.summary;
        if(Buffer.byteLength(JSON.stringify(summary))>16_000)throw corrupt();
        record[key]={...exchange,...summary,state:outcome.state,until:0};
        if(outcome.state==="completed") {
          const text=JSON.stringify(outcome.reply);
          if(Buffer.byteLength(text)>64*1024*1024)throw corrupt();
          await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES($1,$2,$3,$4)
            ON CONFLICT(owner,kind,id) DO UPDATE SET value=$4,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()`,[owner,REPLY_KIND,`${id}-${operation}`,text]);
        }
        return write(db,owner,record);
      });
    },
  };
}

/** Polling carries only this small owned projection, never source, private
 * configuration, exact request bytes, provider prose or a signing claim. */
export function generalPreparationView(record: GeneralPreparation, now=Date.now()) {
  const projectExchange=(exchange:GeneralExchange|undefined)=>exchange?{
    state:exchange.state==="sending"&&exchange.until<=now?"unknown":exchange.state,
    ...Object.fromEntries(["httpStatus","code","disposition","findingCodes","resourceId","backendState"].flatMap(key=>{
      const value=exchange[key as keyof GeneralExchange];return value===undefined?[]:[[key,value]];
    })),
  }:undefined;
  return {version:1 as const,id:record.id,account:record.account,chainId:record.chainId,
    sourceId:record.selection.id,conversationId:record.selection.conversation,...(record.coin?{coin:{name:record.coin.name,symbol:record.coin.symbol}}:{}),
    ...(record.editor?{editor:structuredClone(record.editor)}:{}),
    projectHash:record.selection.projectHash,artifactHash:record.selection.artifactHash,
    packState:record.packState==="packing"&&record.packLease.until<=now?"interrupted":record.packState,
    ...(record.packCode?{code:record.packCode}:{}),...(record.requestHash?{requestHash:record.requestHash}:{}),
    createdAt:record.createdAt,updatedAt:record.updatedAt,expiresAt:Number(record.identity.deadline)*1000,
    ...(record.preflight?{preflight:projectExchange(record.preflight)}:{}),...(record.submission?{submission:projectExchange(record.submission)}:{}),
    launchReady:false as const};
}
