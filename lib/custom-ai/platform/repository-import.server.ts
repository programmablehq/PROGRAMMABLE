import "server-only";
import {createHash} from "node:crypto";
import type {createPlatformStore} from "./project-store.server";
import {projectHash,validateDocument} from "./document";
import {projectFilePath,assertExportableFiles} from "./files";
import {readProjectBundle} from "./transfer";
import {ProjectError,type ProjectFile,type ProjectScope,type ProjectDocument} from "./types";

export type RepositoryClient={get(path:string):Promise<unknown>;post?(path:string,body:unknown,requestKey?:string):Promise<unknown>};
export type RepositoryRequest={repository:string;ref?:string;idempotencyKey:string;connectionId?:string;connectionVersion?:string};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const sha=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{40}$/.test(value);
const fail=(message="The repository snapshot could not be verified.")=>new ProjectError("repository-integrity",message,409);
export function repositoryName(value:string){
 if(typeof value!=="string"||!/^[-A-Za-z0-9_.]{1,100}\/[-A-Za-z0-9_.]{1,100}$/.test(value)||value.split("/").some(part=>part==="."||part===".."))throw new ProjectError("repository-input","Use a GitHub repository in owner/name format.");return value;
}
function excludedPath(path:string){
 const parts=path.split("/");
 if(parts.some(part=>[".git",".ssh","node_modules"].includes(part.toLowerCase())))return "local dependency or private directory";
 if(parts.some(part=>/^\.env(?:\.|$)/i.test(part)&&!/^\.env\.(example|sample|template)$/i.test(part)||[".npmrc",".pypirc",".netrc"].includes(part.toLowerCase())))return "private configuration";
 return null;
}
export async function fetchRepositorySnapshot(client:RepositoryClient,input:{repository:string;ref?:string}){
 const repository=repositoryName(input.repository),ref=input.ref??"HEAD";
 if(typeof ref!=="string"||!ref||ref.length>200||/[\s\\?#\0]/.test(ref))throw new ProjectError("repository-input","Choose a commit or branch reference.");
 const root=`/repos/${repository}`,commit=await client.get(`${root}/commits/${encodeURIComponent(ref)}`);
 if(!object(commit)||!sha(commit.sha)||!object(commit.commit)||!object(commit.commit.tree)||!sha(commit.commit.tree.sha))throw fail();
 const tree=await client.get(`${root}/git/trees/${commit.commit.tree.sha}?recursive=1`);
 if(!object(tree)||tree.sha!==commit.commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree)||tree.tree.length>2000)throw fail("Use a complete repository tree within the import profile.");
 const entries:{path:string;sha:string;size:number;mode:string}[]=[],excluded:{path:string;reason:string}[]=[];
 for(const item of tree.tree){
  if(!object(item)||typeof item.path!=="string"||!sha(item.sha)||typeof item.mode!=="string")throw fail();
  if(item.path.startsWith("/")||item.path.split("/").some(part=>part==="."||part===".."||!part)||item.path.includes("\\"))throw fail("Repository paths must stay inside the project.");
  if(item.type==="commit"||item.mode==="160000"||item.mode==="120000")throw new ProjectError("repository-linked-source","Import the required submodule separately; symbolic links and submodules cannot be followed automatically.",409);
  if(item.type!=="tree"&&item.type!=="blob")throw fail();
  const reason=excludedPath(item.path);if(reason){if(item.type==="blob")excluded.push({path:item.path,reason});continue;}
  projectFilePath(item.path);if(item.type==="tree"){if(item.mode!=="040000")throw fail();continue;}
  if(!["100644","100755"].includes(item.mode)||!Number.isSafeInteger(item.size)||Number(item.size)<0||Number(item.size)>512000)throw new ProjectError("repository-size","Each imported file must fit within 512 KB.",413);
  entries.push({path:item.path,sha:item.sha,size:Number(item.size),mode:item.mode});
 }
 if(!entries.length||entries.length>128||new Set(entries.map(item=>item.path)).size!==entries.length||entries.reduce((size,item)=>size+item.size,0)>3600000)throw new ProjectError("repository-size","Import up to 128 files and 3.6 MB of source in one project.",413);
 const files:Record<string,ProjectFile>=Object.create(null),modes:Record<string,string>=Object.create(null);
 // Sequential bounded reads keep public GitHub limits and cancellation predictable.
 for(const entry of entries.sort((a,b)=>a.path.localeCompare(b.path,"en"))){
  const blob=await client.get(`${root}/git/blobs/${entry.sha}`);
  if(!object(blob)||blob.sha!==entry.sha||blob.encoding!=="base64"||typeof blob.content!=="string")throw fail();
  const encoded=blob.content.replace(/[\r\n]/g,""),bytes=Buffer.from(encoded,"base64");
  if(bytes.toString("base64")!==encoded||bytes.length!==entry.size||blob.size!==entry.size||createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")!==entry.sha)throw fail();
  const text=bytes.toString("utf8");files[entry.path]=Buffer.from(text).equals(bytes)&&!text.includes("\0")?text:{encoding:"base64",content:encoded,mediaType:"application/octet-stream"};modes[entry.path]=entry.mode;
 }
 assertExportableFiles(files);
 return {repository,commit:commit.sha,tree:tree.sha as string,ref,files,modes,excluded};
}
type ImportScope=ProjectScope&{execution?:{runId:string;leaseToken:string}};
export function createRepositoryImporter(projects:ReturnType<typeof createPlatformStore>,clientFor:(scope:ProjectScope,input:RepositoryRequest,signal?:AbortSignal)=>Promise<RepositoryClient>){
 async function existing(scope:ProjectScope,key:string,requestHash:string){
  try{const receipt=await projects.readPatchReceipt(scope,key);if(!receipt)return null;const architecture=receipt.document.architecture as Record<string,unknown>|null;
   if(!object(architecture?.importProvenance)||architecture.importProvenance.requestHash!==requestHash)throw new ProjectError("repository-idempotency","This import identifier has different contents.",409);return receipt;
  }catch(error){if(error instanceof ProjectError&&error.code==="project-missing")return null;throw error;}
 }
 async function save(scope:ImportScope,key:string,requestHash:string,document:ProjectDocument,origin:Record<string,unknown>){
  const architecture=object(document.architecture)?document.architecture:{originalArchitecture:document.architecture};
  const previous=object(architecture.importProvenance)?architecture.importProvenance:undefined;
  const modes=object(previous?.fileModes)?previous.fileModes:undefined;
  const next={...document,architecture:{...architecture,importProvenance:{...(modes?{fileModes:modes}:{}),...origin,requestHash,verification:"not-run",...(previous?{previous}:{})}}};validateDocument(next);
  const first=await projects.createProject(scope);
  if(first.ordinal!==1||Object.keys(first.document.files).length||first.document.requirements.length){const receipt=await existing(scope,key,requestHash);if(receipt)return receipt;throw new ProjectError("repository-target","Import into a new empty project to preserve existing work.",409);}
  return projects.applyProjectPatch({...scope,expectedRevisionId:first.revisionId,idempotencyKey:key,patch:next,...(scope.execution?{execution:scope.execution}:{})});
 }
 async function importRepository(scope:ImportScope,input:RepositoryRequest,signal?:AbortSignal){
  if(typeof input.idempotencyKey!=="string"||!/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey)||Boolean(input.connectionId)!==Boolean(input.connectionVersion))throw new ProjectError("repository-input","Use a valid import request and complete connection reference.");
  const requestHash=projectHash({kind:"github",repository:repositoryName(input.repository),ref:input.ref??"HEAD",connectionId:input.connectionId??null,connectionVersion:input.connectionVersion??null}),prior=await existing(scope,input.idempotencyKey,requestHash);if(prior)return prior;
  const snapshot=await fetchRepositorySnapshot(await clientFor(scope,input,signal),input);signal?.throwIfAborted();
  return save(scope,input.idempotencyKey,requestHash,{title:snapshot.repository.split("/")[1].slice(0,120),requirements:[],files:snapshot.files,dependencies:{},architecture:null},
   {kind:"github",repository:snapshot.repository,commit:snapshot.commit,tree:snapshot.tree,fileModes:snapshot.modes,excluded:snapshot.excluded});
 }
 async function importBundle(scope:ImportScope,input:{bundle:unknown;idempotencyKey:string}){
  if(typeof input.idempotencyKey!=="string"||!/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))throw new ProjectError("repository-input","Use a valid import request identifier.");
  const document=readProjectBundle(input.bundle),requestHash=projectHash({kind:"bundle",document}),prior=await existing(scope,input.idempotencyKey,requestHash);if(prior)return prior;
  return save(scope,input.idempotencyKey,requestHash,document,{kind:"bundle",documentHash:projectHash(document)});
 }
 return {importRepository,importBundle};
}
