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

export type ProjectCheckpoint = {
  version: 1;
  requestId: string;
  payloadHash: string;
  project: ContractProject;
  compilation?: CompiledProject;
  overview?: ProjectOverview;
  blueprintId?: GeneralCheckBlueprint["id"];
  scenarios?: GeneralScenarioReport;
};
export type BlueprintCheckpoint = {version:1;requestId:string;payloadHash:string;intent:LaunchIntent;blueprint:GeneralCheckBlueprint};
type Transaction = <T>(work: (connection: AIConnection) => Promise<T>) => Promise<T>;
const kind = "contract-project";
const blueprintKind = "contract-check-blueprint";
const conflict = () => new CustomAIError("project-conflict", "This saved source belongs to a different revision. Your earlier project is kept.", 409);

/** Uses the existing owned job and object tables. Source survives a compiler
 * failure; polling never needs to transfer it. Only the active lease may write. */
export function createProjectStore(transaction: Transaction) {
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
  async function save(owner: string, id: string, lease: string, project: ContractProject) {
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
      const declared=await savedBlueprint(db,owner,id);
      if(declared)try{bindGeneralCheckBlueprint(declared.blueprint,project);}catch{throw conflict();}
      const value: ProjectCheckpoint = { version: 1, requestId: id, payloadHash, project, overview: projectOverview(id, project),
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
    if(Object.keys(report).sort().join()!==keys||report.version!==1||report.scope!=="isolated-declared-scenarios-v1"||report.launchReady!==false
      ||hash!==canonicalBrowserSha256V2("programmable.general-scenario-report.v1",body)||Buffer.byteLength(JSON.stringify(report))>96_000
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
      if(plan.id!==report.planHash||report.passed&&report.cases!==plan.contracts.length*2+plan.steps.length
        ||JSON.stringify(report.requirementIds)!==JSON.stringify(previous.project.intent.requirements.map(rule=>rule.id).sort()))throw conflict();
      if(previous.scenarios){if(previous.scenarios.hash!==hash)throw conflict();return previous;}
      const value:ProjectCheckpoint={...previous,scenarios:structuredClone(report)};
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
      const value: ProjectCheckpoint = { ...previous, compilation, overview: projectOverview(id, previous.project, compilation) };
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
  return { save, complete, overview, saveBlueprint, saveScenarios,
    readBlueprint:(owner:string,id:string)=>transaction(db=>savedBlueprint(db,owner,id)),
    read: (owner: string, id: string) => transaction(db => saved(db, owner, id)) };
}
