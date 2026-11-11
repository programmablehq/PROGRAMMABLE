import "server-only";
import {createHash} from "node:crypto";
import type {createSandboxExecutor} from "./sandbox-executor.server";
import type {createArtifactStore} from "./artifacts.server";
import type {AppPackage,AppPlan} from "./releases.server";
import {projectFilePath,projectFileBytes} from "./files";
import {projectHash} from "./document";
import {ProjectError,type ProjectFile,type ProjectRevision,type ProjectScope} from "./types";

const packageScript=String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const plan=JSON.parse(Buffer.from(process.argv[2],'base64').toString('utf8'));
const root=process.cwd(),output=path.join(root,'.vercel/output');
fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
const ignore=new Set(['node_modules','.git','.vercel','test','tests','.programmable-bundle.json']);
function files(dir,rel=''){if(!fs.existsSync(dir))return [];let list=[];for(const name of fs.readdirSync(dir)){if(ignore.has(name))continue;const absolute=path.join(dir,name),stat=fs.lstatSync(absolute);if(stat.isSymbolicLink())throw Error('Symlinks are not deployable');const file=rel?rel+'/'+name:name;if(stat.isDirectory())list.push(...files(absolute,file));else if(stat.isFile())list.push({absolute,file});}return list;}
function copy(src,dst){fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);}
const staticDir=plan.outputDirectory||(plan.framework==='vite'?'dist':'public');
if(staticDir==='.'||staticDir.startsWith('/')||staticDir.split('/').includes('..'))throw Error('Use a dedicated static output directory');
for(const item of files(path.join(root,staticDir)))copy(item.absolute,path.join(output,'static',item.file));
if(!fs.existsSync(path.join(output,'static/index.html'))&&fs.existsSync(path.join(root,'index.html')))copy(path.join(root,'index.html'),path.join(output,'static/index.html'));
const api=files(path.join(root,'api')).filter(item=>/\.(?:js|mjs|cjs|ts)$/.test(item.file));if(api.length>20)throw Error('Too many API functions');
const esbuild=path.join(root,'node_modules/.bin/esbuild');
for(const item of api){
 const name=item.file.replace(/\.(?:js|mjs|cjs|ts)$/,'');if(!/^[A-Za-z0-9_/-]+$/.test(name))throw Error('Use ordinary API path names');
 const dir=path.join(output,'functions/api',name+'.func');fs.mkdirSync(dir,{recursive:true});
 if(fs.existsSync(esbuild)){
  const result=cp.spawnSync(esbuild,[item.absolute,'--bundle','--platform=node','--format=cjs','--target=node24','--outfile='+path.join(dir,'bundle.cjs')],{encoding:'utf8',timeout:60000,maxBuffer:64000});if(result.status!==0)throw Error('API bundling failed: '+result.stderr);
  fs.writeFileSync(path.join(dir,'index.cjs'),"const m=require('./bundle.cjs');module.exports=(req,res)=>(m.default||m)(req,res);");
 }else{
  if(item.file.endsWith('.ts'))throw Error('Add pinned esbuild for TypeScript API bundles');
  const sources=files(root).filter(file=>/\.(?:[mc]?js|json)$/.test(file.file)&&!file.file.startsWith(staticDir+'/'));
  for(const source of sources){const text=fs.readFileSync(source.absolute,'utf8');const imports=[...text.matchAll(/(?:from\s*|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g)];if(imports.some(match=>!match[1].startsWith('.')&&!match[1].startsWith('node:')))throw Error('Add pinned esbuild to bundle external API dependencies');copy(source.absolute,path.join(dir,'project',source.file));}
  fs.writeFileSync(path.join(dir,'index.cjs'),"module.exports=async(req,res)=>{const m=await import('./project/api/"+item.file+"');return (m.default||m)(req,res)};");
 }
 fs.writeFileSync(path.join(dir,'.vc-config.json'),JSON.stringify({runtime:'nodejs24.x',handler:'index.cjs',launcherType:'Nodejs',shouldAddHelpers:true,maxDuration:30,memory:1024}));
}
fs.writeFileSync(path.join(output,'config.json'),JSON.stringify({version:3}));
const result={};let size=0;
for(const item of files(output)){const value=fs.readFileSync(item.absolute);size+=value.length;if(size>2500000||value.length>1500000)throw Error('The application artifact exceeds the deployment profile');result['.vercel/output/'+item.file]=value.toString('base64');}
fs.writeFileSync(path.join(root,'.programmable-bundle.json'),JSON.stringify(result));
`;
export const APP_PACKAGER_HASH=`sha256:${createHash("sha256").update(packageScript).digest("hex")}`;
const packageHash=(files:Record<string,ProjectFile>)=>projectHash(Object.fromEntries(Object.entries(files).map(([path,file])=>[path,createHash("sha256").update(projectFileBytes(file)).digest("hex")])));
function assertPublicAssets(files:Record<string,ProjectFile>){
 const attribute=(tag:string,name:string)=>{const match=tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,"i"));return match?.[1]??match?.[2]??match?.[3];};
 for(const[path,file]of Object.entries(files)){
  if(!path.startsWith(".vercel/output/static/")||!path.endsWith(".html")||typeof file!=="string")continue;
  const page=new URL(path.slice(".vercel/output/static".length),"https://app.invalid");
  for(const match of file.matchAll(/<(script|link)\b[^>]*>/gi)){
   const script=match[1].toLowerCase()==="script";
   if(!script&&!/^(?:stylesheet|modulepreload|preload|icon)(?:\s|$)/i.test(attribute(match[0],"rel")??""))continue;
   const reference=attribute(match[0],script?"src":"href");if(!reference||reference.startsWith("#"))continue;
   const asset=new URL(reference.replaceAll("&amp;","&"),page);if(asset.origin!==page.origin)continue;
   if(!Object.hasOwn(files,`.vercel/output/static${decodeURIComponent(asset.pathname)}`))throw new ProjectError("app-static-asset",`The public output is missing ${asset.pathname}, referenced by ${page.pathname}. Put every browser script and stylesheet in the declared outputDirectory before building a preview.`,409);
  }
 }
}
export function createAppPackageLoader(artifacts:ReturnType<typeof createArtifactStore>){
 return async(scope:ProjectScope,id:string):Promise<AppPackage>=>{
  const artifact=await artifacts.readArtifact(scope,id);
  const value=JSON.parse(Buffer.from(artifact.bytes).toString("utf8"));
  if(value.version!==1||value.packagerHash!==APP_PACKAGER_HASH||!value.files||packageHash(value.files)!==value.artifactHash)throw new ProjectError("release-artifact","The stored deployment package does not match its proof.",409);
  assertPublicAssets(value.files);
  return {files:value.files,artifactHash:value.artifactHash,artifactId:id};
 };
}
export function validateAppPackage(raw:unknown,revisionId:string):Record<string,ProjectFile>{
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).length>1024||!/^sha256:[a-f0-9]{64}$/.test(revisionId))throw new ProjectError("app-package","The application package is invalid.",409);
 const files:Record<string,ProjectFile>={};let total=0;const functions:string[]=[];
 for(const[path,encoded]of Object.entries(raw)){
  projectFilePath(path);if(!path.startsWith(".vercel/output/")||typeof encoded!=="string")throw new ProjectError("app-package","Package files must stay inside the build output.",409);
  const bytes=Buffer.from(encoded,"base64");if(bytes.toString("base64")!==encoded||bytes.length>1500000||(total+=bytes.length)>2500000)throw new ProjectError("app-package-size","The application package exceeds its resource profile.",413);
  const text=bytes.toString("utf8");files[path]=Buffer.from(text).equals(bytes)&&!text.includes("\0")?text:{encoding:"base64",content:encoded,mediaType:"application/octet-stream"};
 }
 const config=files[".vercel/output/config.json"];if(typeof config!=="string"||JSON.parse(config).version!==3)throw new ProjectError("app-package","Use Build Output API version 3.",409);
 assertPublicAssets(files);
 for(const[path,file]of Object.entries(files))if(path.endsWith("/.vc-config.json")){
  const prefix=path.slice(0,-"/.vc-config.json".length),name=prefix.replace(".vercel/output/functions/","").replace(/\.func$/,"");
  if(!prefix.startsWith(".vercel/output/functions/")||!prefix.endsWith(".func")||!/^[A-Za-z0-9_/-]{1,128}$/.test(name)||typeof file!=="string")throw new ProjectError("app-package","Unsupported function package.",409);
  const settings=JSON.parse(file);if(settings.runtime!=="nodejs24.x"||settings.maxDuration!==undefined&&settings.maxDuration>30||Object.keys(settings).some(key=>!["runtime","handler","launcherType","shouldAddHelpers","shouldAddSourcemapSupport","maxDuration","memory"].includes(key))||typeof settings.handler!=="string")throw new ProjectError("app-package","Keep functions inside the approved runtime profile.",409);
  projectFilePath(settings.handler);if(!Object.hasOwn(files,`${prefix}/${settings.handler}`))throw new ProjectError("app-package","A function handler is missing.",409);
  files[path]=JSON.stringify({runtime:"nodejs24.x",handler:settings.handler,launcherType:"Nodejs",shouldAddHelpers:true,maxDuration:30,memory:1024});functions.push(name);
 }
 if(functions.length>20)throw new ProjectError("app-package","The application has too many functions.",413);
 const health=".vercel/output/functions/api/_programmable.func";
 files[`${health}/.vc-config.json`]=JSON.stringify({runtime:"nodejs24.x",handler:"index.cjs",launcherType:"Nodejs",shouldAddHelpers:true,maxDuration:5,memory:1024});
 files[`${health}/index.cjs`]=`module.exports=(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({ok:true,revisionId:${JSON.stringify(revisionId)}}))};`;
 const routes=[...new Set([...functions,"api/_programmable"])].map(name=>({src:`^/${name}/?$`,dest:`/${name}`}));
 files[".vercel/output/config.json"]=JSON.stringify({version:3,routes:[...routes,{handle:"filesystem"},...(files[".vercel/output/static/index.html"]?[{src:"/.*",dest:"/index.html"}]:[])]});
 return files;
}
export function createAppPackager(sandbox:ReturnType<typeof createSandboxExecutor>,artifacts:ReturnType<typeof createArtifactStore>){
 return async(revision:ProjectRevision,plan:AppPlan):Promise<AppPackage>=>{
  if(plan.framework==="nextjs")throw new ProjectError("app-runtime","Use the static/Node or Vite application profile for this bounded deployment runtime.",409);
  const encoded=Buffer.from(JSON.stringify(plan)).toString("base64");
  const script=`${plan.buildCommand?`(${plan.buildCommand}) && `:plan.framework==="vite"?"npm run build && ":""}node - '${encoded}' <<'PROGRAMMABLE_PACKAGE'\n${packageScript}\nPROGRAMMABLE_PACKAGE`;
  const result=await sandbox.execute({ownerId:revision.ownerId,projectId:revision.projectId,revisionId:revision.revisionId,script,outputPaths:[],artifactPaths:[".programmable-bundle.json"]});
  if(result.exitCode!==0||!result.artifacts?.[".programmable-bundle.json"])throw new ProjectError("app-build",`The application package failed: ${result.stderr.slice(0,1500)}`,409);
  const files=validateAppPackage(JSON.parse(Buffer.from(result.artifacts[".programmable-bundle.json"],"base64").toString("utf8")),revision.revisionId);
  const artifactHash=packageHash(files);
  const artifact=await artifacts.saveArtifact({ownerId:revision.ownerId,projectId:revision.projectId},{bytes:Buffer.from(JSON.stringify({version:1,revisionId:revision.revisionId,packagerHash:APP_PACKAGER_HASH,artifactHash,files})),mediaType:"application/json"});
  return {files,artifactHash,artifactId:artifact.id};
 };
}
