import { checkedGeneralLaunchSource, type GeneralLaunchSourceSelection } from "./general-launch-source.server";
import { conversationStorageId } from "./conversation.server";
import type { Conversation } from "./conversation";
import type { StudioState } from "./studio";
import type { ChatRequest, ChatResult } from "./types";
import "server-only";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectCompilerInput, type ContractProject } from "./contract-project";
import type { CompiledProject } from "./contract-project.server";
import { CustomAIError } from "./types";
import type { AIConnection } from "./store.server";
import { projectOverview, type ProjectOverview } from "./project-overview";
import { bindGeneralCheckBlueprint, checkedGeneralCheckBlueprint, type GeneralCheckBlueprint } from "./check-blueprint";
import type { LaunchIntent } from "./launch-intent";
import type { GeneralScenarioReport } from "./behavior-checks.server";
import {checkedGeneralSourceAudit,type GeneralSourceAudit} from "./source-audit.server";
import { generalCheckCaseCount } from "./behavior-checks";
import { checkedGeneralPublicSource, createGeneralPublicSource, generalSourcePublicUri, type GeneralPublicSource } from "./public-launch-source.server";
import { createGeneralPreparationStore } from "./general-preparation-store.server";

export type ProjectCheckpoint = {
  version: 1;
  requestId: string;
  payloadHash: string;
  /** First successful source save. Older checkpoints may not have a timestamp. */
  sourceGeneratedAt?: number;
  project: ContractProject;
  compilation?: CompiledProject;
  overview?: ProjectOverview;
  blueprintId?: GeneralCheckBlueprint["id"];
  scenarios?: GeneralScenarioReport;
  sourceAudit?: GeneralSourceAudit;
};
export type BlueprintCheckpoint = {version:1;requestId:string;payloadHash:string;intent:LaunchIntent;blueprint:GeneralCheckBlueprint};
type Transaction = <T>(work: (connection: AIConnection) => Promise<T>) => Promise<T>;
const kind = "contract-project";
const blueprintKind = "contract-check-blueprint";
const conflict = () => new CustomAIError("project-conflict", "This saved source belongs to a different revision. Your earlier project is kept.", 409);

/** Uses the existing owned job and object tables. Source survives a compiler
 * failure; polling never needs to transfer it. Only the active lease may write. */
export function createProjectStore(transaction: Transaction, now: () => number = Date.now) {
  async function active(db: AIConnection, owner: string, id: string, lease: string) {
    const row = (await db.query(`SELECT payload_hash FROM programmable_custom_ai_v1.jobs
      WHERE owner=$1 AND id=$2 AND lease=$3 AND state='running'
      AND created_at >= now()-interval '10 minutes' FOR UPDATE`, [owner, id, lease])).rows[0];
    if (!row) throw new CustomAIError("interrupted", "This request is no longer running. Your saved source is kept.", 409);
    return String(row.payload_hash);
  }
  async function saved(db: AIConnection, owner: string, id: string): Promise<ProjectCheckpoint | null> {
    const row = (await db.query(`SELECT o.value FROM programmable_custom_ai_v1.objects o
      JOIN programmable_custom_ai_v1.jobs j ON j.owner=o.owner AND j.id=o.id
      AND j.payload_hash=o.value->>'payloadHash'
      WHERE o.owner=$1 AND o.id=$2 AND o.kind=$3`, [owner, id, kind])).rows[0];
    return row ? row.value as ProjectCheckpoint : null;
  }
  async function savedBlueprint(db: AIConnection,owner:string,id:string):Promise<BlueprintCheckpoint|null>{
    const row=(await db.query(`SELECT o.value FROM programmable_custom_ai_v1.objects o
      JOIN programmable_custom_ai_v1.jobs j ON j.owner=o.owner AND j.id=o.id
      AND j.payload_hash=o.value->>'payloadHash'
      WHERE o.owner=$1 AND o.id=$2 AND o.kind=$3`,[owner,id,blueprintKind])).rows[0];
    return row?row.value as BlueprintCheckpoint:null;
  }
  async function saveBlueprint(owner:string,id:string,lease:string,input:Pick<BlueprintCheckpoint,"intent"|"blueprint">){
    const intent=structuredClone(input.intent),blueprint=checkedGeneralCheckBlueprint(input.blueprint,intent);
    if(Buffer.byteLength(JSON.stringify({intent,blueprint}))>384_000)throw new CustomAIError("project-size","This declared design is too large to save.",422);
    return transaction(async db=>{
      const payloadHash=await active(db,owner,id,lease),previous=await savedBlueprint(db,owner,id);
      if(previous){if(previous.blueprint.id!==blueprint.id)throw conflict();return previous;}
      // A plan created after source already exists cannot acquire the status
      // of an independent pre-generation receipt.
      if(await saved(db,owner,id))throw conflict();
      const value:BlueprintCheckpoint={version:1,requestId:id,payloadHash,intent,blueprint};
      await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value)
        VALUES($1,$2,$3,$4)`,[owner,blueprintKind,id,JSON.stringify(value)]);
      return value;
    });
  }
  async function save(owner: string, id: string, lease: string, project: ContractProject, originalSourceId?:string) {
    projectCompilerInput(project);
    project=structuredClone(project);
    // This dedicated server-only path accommodates the complete bounded source
    // package without raising the ordinary chat/image object-write limit.
    if (Buffer.byteLength(JSON.stringify(project)) > 3_000_000) throw new CustomAIError("project-size", "This source package is too large to save.", 422);
    return transaction(async db => {
      const payloadHash = await active(db, owner, id, lease), previous = await saved(db, owner, id);
      if (previous) {
        if (previous.project.hash !== project.hash) throw conflict();
        return previous;
      }
      const original=originalSourceId?await saved(db,owner,originalSourceId):null;
      if(originalSourceId&&(!original||original.project.hash!==project.hash))throw conflict();
      const declared=await savedBlueprint(db,owner,id);
      if(declared)try{bindGeneralCheckBlueprint(declared.blueprint,project);}catch{throw conflict();}
      // A compile retry reuses old source. It must not reset the time target,
      // and a legacy source without timing must stay explicitly unknown.
      const timing=original?(original.sourceGeneratedAt===undefined?{}:{sourceGeneratedAt:original.sourceGeneratedAt}):{sourceGeneratedAt:now()};
      const value: ProjectCheckpoint = { version: 1, requestId: id, payloadHash, ...timing, project, overview: projectOverview(id, project,undefined,declared?{blueprintId:declared.blueprint.id}:undefined),
        ...(declared?{blueprintId:declared.blueprint.id}:{}) };
      await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value)
        VALUES($1,$2,$3,$4)`, [owner, kind, id, JSON.stringify(value)]);
      return value;
    });
  }
  async function saveScenarios(owner:string,id:string,lease:string,report:GeneralScenarioReport){
    report=structuredClone(report);
    const {hash,...body}=report;
    const keys="artifactHash,cases,failures,gasUsed,hash,launchReady,passed,planHash,projectHash,requirementIds,scope,version";
    if(Object.keys(report).sort().join()!==keys||![1,2].includes(report.version)||report.scope!==`isolated-declared-scenarios-v${report.version}`||report.launchReady!==false
      ||hash!==canonicalBrowserSha256V2(`programmable.general-scenario-report.v${report.version}`,body)||Buffer.byteLength(JSON.stringify(report))>96_000
      ||typeof report.passed!=="boolean"||!Number.isSafeInteger(report.cases)||report.cases<0||report.cases>300
      ||typeof report.gasUsed!=="string"||!/^\d{1,20}$/.test(report.gasUsed)||!Array.isArray(report.failures)||report.failures.length>32
      ||report.passed!==(report.failures.length===0)||report.failures.some(item=>!item||typeof item.caseId!=="string"||item.caseId.length>100
        ||typeof item.code!=="string"||item.code.length>100||typeof item.message!=="string"||item.message.length>500))throw conflict();
    return transaction(async db=>{
      await active(db,owner,id,lease);
      const previous=await saved(db,owner,id),declared=await savedBlueprint(db,owner,id);
      if(!previous?.compilation?.compiled||!declared||previous.blueprintId!==declared.blueprint.id
        ||previous.project.hash!==report.projectHash||previous.compilation.artifactHash!==report.artifactHash)throw conflict();
      const plan=bindGeneralCheckBlueprint(declared.blueprint,previous.project);
      if(plan.id!==report.planHash||plan.version!==report.version||report.passed&&report.cases!==generalCheckCaseCount(plan)
        ||JSON.stringify(report.requirementIds)!==JSON.stringify(previous.project.intent.requirements.map(rule=>rule.id).sort()))throw conflict();
      if(previous.scenarios){if(previous.scenarios.hash!==hash)throw conflict();return previous;}
      const value:ProjectCheckpoint={...previous,scenarios:report,overview:projectOverview(id,previous.project,previous.compilation,{blueprintId:declared.blueprint.id,scenarios:report})};
      await db.query(`UPDATE programmable_custom_ai_v1.objects SET value=$4,revision=revision+1,updated_at=now()
        WHERE owner=$1 AND kind=$2 AND id=$3`,[owner,kind,id,JSON.stringify(value)]);
      return value;
    });
  }
  async function saveSourceAudit(owner:string,id:string,lease:string,audit:GeneralSourceAudit){
    return transaction(async db=>{
      await active(db,owner,id,lease);
      const previous=await saved(db,owner,id);if(!previous)throw conflict();
      const checked=checkedGeneralSourceAudit(audit,previous.project);
      if(previous.sourceAudit){if(previous.sourceAudit.hash!==checked.hash)throw conflict();return previous;}
      if(Buffer.byteLength(JSON.stringify(checked))>64_000)throw conflict();
      const value:ProjectCheckpoint={...previous,sourceAudit:checked};
      await db.query(`UPDATE programmable_custom_ai_v1.objects SET value=$4,revision=revision+1,updated_at=now()
        WHERE owner=$1 AND kind=$2 AND id=$3`,[owner,kind,id,JSON.stringify(value)]);
      return value;
    });
  }
  async function complete(owner: string, id: string, lease: string, compilation: CompiledProject) {
    compilation=structuredClone(compilation);
    const { artifactHash, ...body } = compilation;
    if (compilation.version !== 1 || compilation.verification !== "not-run" || compilation.launchReady !== false
      || canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", body) !== artifactHash
      || Buffer.byteLength(JSON.stringify(compilation)) > 4_000_000) throw conflict();
    return transaction(async db => {
      await active(db, owner, id, lease);
      const previous = await saved(db, owner, id);
      if (!previous || previous.project.hash !== compilation.projectHash) throw conflict();
      if (previous.compilation) {
        if (previous.compilation.artifactHash !== artifactHash) throw conflict();
        return previous;
      }
      const value: ProjectCheckpoint = { ...previous, compilation, overview: projectOverview(id, previous.project, compilation,{blueprintId:previous.blueprintId,scenarios:previous.scenarios}) };
      await db.query(`UPDATE programmable_custom_ai_v1.objects SET value=$4,revision=revision+1,updated_at=now()
        WHERE owner=$1 AND kind=$2 AND id=$3`, [owner, kind, id, JSON.stringify(value)]);
      return value;
    });
  }
  async function overview(owner: string, id: string): Promise<ProjectOverview | null> {
    return transaction(async db => {
      const row = (await db.query(`SELECT o.value->'overview' AS overview FROM programmable_custom_ai_v1.objects o
        JOIN programmable_custom_ai_v1.jobs j ON j.owner=o.owner AND j.id=o.id
        AND j.payload_hash=o.value->>'payloadHash'
        WHERE o.owner=$1 AND o.id=$2 AND o.kind=$3`, [owner, id, kind])).rows[0];
      return row?.overview ? row.overview as ProjectOverview : null;
    });
  }
  async function readForLaunchInTransaction(db: AIConnection, owner: string, selected: GeneralLaunchSourceSelection) {
    const storageId = conversationStorageId(selected.account, selected.conversation);
      // Match the conversation/studio CAS lock order. No model, compiler,
      // network, funding or signing work is performed while these are held.
      const meta = (await db.query(`SELECT value FROM programmable_custom_ai_v1.objects
        WHERE owner=$1 AND kind='conversation' AND id=$2 FOR UPDATE`, [owner, storageId])).rows[0];
      const studio = (await db.query(`SELECT revision,value FROM programmable_custom_ai_v1.objects
        WHERE owner=$1 AND kind='studio' AND id=$2 FOR UPDATE`, [owner, storageId])).rows[0];
      const state = studio?.value as StudioState | undefined;
      const conversation = meta?.value as Conversation | undefined;
      if (!conversation || conversation.archived || conversation.activeRequest || !studio || !state?.contextId || state.draftId !== selected.id
        || state.pendingChange?.trim() || state.settings?.chainId !== selected.chainId
        || Number(studio.revision) !== selected.studioRevision && selected.bindingHash === undefined)
        throw new CustomAIError("launch-source-changed", "Open the current saved design before preparing this launch.", 409);
      const rows = (await db.query(`SELECT id,payload_hash,request,result,state FROM programmable_custom_ai_v1.jobs
        WHERE owner=$1 AND id=ANY($2::text[])`, [owner, [...new Set([selected.id, state.contextId])]])).rows;
      const source = rows.find(row => row.id === selected.id), context = rows.find(row => row.id === state.contextId);
      if (!source || !context || source.state !== "completed" || context.state !== "completed")
        throw new CustomAIError("launch-source-changed", "Finish the current saved reply before preparing this launch.", 409);
      const checkpoint = await saved(db, owner, selected.id), declared = await savedBlueprint(db, owner, selected.id);
      if (!source || !context || !checkpoint || !declared)
        throw new CustomAIError("launch-source-checks", "Finish the saved source and behavior checks before preparing this launch.", 422);
      return checkedGeneralLaunchSource(owner, selected, { conversation: meta.value as Conversation,
        studioRevision: Number(studio.revision), studio: state,
        sourceJob: { state: String(source.state), payloadHash: String(source.payload_hash), request: source.request as ChatRequest, result: source.result as ChatResult },
        contextJob: { state: String(context.state), request: context.request as ChatRequest, result: context.result as ChatResult }, checkpoint, declared });
  }
  const readForLaunch = (owner: string, selected: GeneralLaunchSourceSelection) => transaction(db => readForLaunchInTransaction(db, owner, selected));
  /** Called only after an explicit authenticated launch-preparation action.
   * Revalidate the owned selection under the same CAS locks before publishing
   * this fixed, sanitized record. A normal project read never publishes it. */
  async function publishForLaunch(owner: string, selected: GeneralLaunchSourceSelection) {
    return transaction(async db => {
      const source = await readForLaunchInTransaction(db, owner, selected);
      const saved = await publishSourceInTransaction(db, source);
      return { source, exported: saved, url: generalSourcePublicUri(saved.id), launchReady: false as const };
    });
  }
  async function publishSourceInTransaction(db: AIConnection, source: Awaited<ReturnType<typeof readForLaunchInTransaction>>) {
      const exported = createGeneralPublicSource(source);
      const id = exported.id.slice(7);
      await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value)
        VALUES('public','launch-source',$1,$2) ON CONFLICT DO NOTHING`, [id, JSON.stringify(exported)]);
      const row = (await db.query(`SELECT value FROM programmable_custom_ai_v1.objects
        WHERE owner='public' AND kind='launch-source' AND id=$1`, [id])).rows[0];
      const saved = checkedGeneralPublicSource(row?.value as GeneralPublicSource, exported.id);
      return saved;
  }
  async function readPublicSource(id: string) {
    if (!/^[a-f0-9]{64}$/u.test(id)) return null;
    return transaction(async db => {
      const row = (await db.query(`SELECT value FROM programmable_custom_ai_v1.objects
        WHERE owner='public' AND kind='launch-source' AND id=$1`, [id])).rows[0];
      return row ? checkedGeneralPublicSource(row.value as GeneralPublicSource, `sha256:${id}`) : null;
    });
  }
  /** Original source-checkpoint time, not this request's clock or the last
   * compilation/update. Legacy source never receives an invented timestamp. */
  async function readSourceCreatedAt(owner:string,id:string,projectHash:string):Promise<number|null> {
    return transaction(async db=>{
      const row=(await db.query(`SELECT o.value->'sourceGeneratedAt' AS source_generated_at
        FROM programmable_custom_ai_v1.objects o
        JOIN programmable_custom_ai_v1.jobs j ON j.owner=o.owner AND j.id=o.id AND j.payload_hash=o.value->>'payloadHash'
        WHERE o.owner=$1 AND o.kind=$2 AND o.id=$3 AND o.value#>>'{project,hash}'=$4`,[owner,kind,id,projectHash])).rows[0];
      if(!row||row.source_generated_at===null)return null;
      const value=Number(row.source_generated_at);
      if(!Number.isSafeInteger(value)||value<0)throw new CustomAIError("source-timing","The saved source timing could not be read.",503);
      return value;
    });
  }
  return { save, complete, overview, saveBlueprint, saveScenarios, saveSourceAudit, readForLaunch, publishForLaunch, readPublicSource, readSourceCreatedAt,
    preparations: createGeneralPreparationStore(transaction, {read:readForLaunchInTransaction,
      publish:async (db,source)=>{await publishSourceInTransaction(db,source);}}, now),
    readBlueprint:(owner:string,id:string)=>transaction(db=>savedBlueprint(db,owner,id)),
    read: (owner: string, id: string) => transaction(db => saved(db, owner, id)) };
}
