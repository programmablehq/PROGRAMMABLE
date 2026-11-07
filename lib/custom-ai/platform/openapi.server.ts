import "server-only";
import { validateConnectionManifest,type ConnectionManifest,type ConnectionAction } from "./connections.server";
import { validateConnectorURL } from "./private-http.server";
import { ProjectError } from "./types";
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const fail=()=>new ProjectError("openapi-input","Use a bounded OpenAPI 3 JSON document with a public HTTPS server.");
export function importOpenAPI(document:unknown,options:{name:string;server?:string;auth?:ConnectionManifest["auth"]}){
  if(!object(document)||!/^3\./.test(String(document.openapi))||JSON.stringify(document).length>1000000||!object(document.paths))throw fail();
  const servers=Array.isArray(document.servers)?document.servers:[];
  const base=validateConnectorURL(options.server??(object(servers[0])?String(servers[0].url):""));
  const warnings:string[]=[],actions:ConnectionAction[]=[];
  function resolve(value:unknown,depth=0):Record<string,unknown>{
    if(depth>12||!object(value))throw fail();if(typeof value.$ref!=="string")return value;
    if(!value.$ref.startsWith("#/"))throw fail();let target:unknown=document;
    for(const part of value.$ref.slice(2).split("/")){if(!object(target))throw fail();target=target[part.replaceAll("~1","/").replaceAll("~0","~")];}
    return resolve(target,depth+1);
  }
  function schema(value:unknown,depth=0):Record<string,unknown>{
    if(depth>16)throw fail();const raw=resolve(value),next:Record<string,unknown>={};
    for(const[key,item]of Object.entries(raw)){
      if(["example","examples","default","externalDocs"].includes(key))continue;
      if(key==="properties"&&object(item))next[key]=Object.fromEntries(Object.entries(item).map(([name,child])=>[name,schema(child,depth+1)]));
      else if(key==="items"&&object(item))next[key]=schema(item,depth+1);
      else if(["allOf","anyOf","oneOf"].includes(key)&&Array.isArray(item))next[key]=item.map(child=>schema(child,depth+1));
      else next[key]=item;
    }
    return next;
  }
  for(const[path,rawPath]of Object.entries(document.paths)){
    const pathObject=resolve(rawPath);
    for(const method of ["get","post","put","patch","delete"]){
      if(!pathObject[method])continue;
      try{
        const operation=resolve(pathObject[method]),parameters=[...(Array.isArray(pathObject.parameters)?pathObject.parameters:[]),...(Array.isArray(operation.parameters)?operation.parameters:[])].map(item=>resolve(item));
        if(parameters.some(param=>!["path","query"].includes(String(param.in)))){warnings.push(`${method.toUpperCase()} ${path}: header/cookie parameters need a reviewed manual action.`);continue;}
        const grouped:Record<string,Record<string,unknown>>={path:{},query:{}},required:Record<string,string[]>={path:[],query:[]};
        for(const parameter of parameters){const kind=String(parameter.in),name=String(parameter.name);if(!/^[-A-Za-z0-9_]{1,100}$/.test(name))throw fail();grouped[kind][name]=schema(parameter.schema??{type:"string"});if(parameter.required||kind==="path")required[kind].push(name);}
        const properties:Record<string,unknown>={},requiredGroups:string[]=[];
        for(const kind of ["path","query"]){if(Object.keys(grouped[kind]).length){properties[kind]={type:"object",properties:grouped[kind],required:required[kind],additionalProperties:false};if(required[kind].length)requiredGroups.push(kind);}}
        let hasBody=false;if(operation.requestBody){const body=resolve(operation.requestBody),content=object(body.content)?body.content:{};const media=object(content["application/json"])?content["application/json"]:{};
          if(!media.schema){warnings.push(`${method.toUpperCase()} ${path}: only JSON request bodies are supported.`);continue;}properties.body=schema(media.schema);hasBody=true;if(body.required)requiredGroups.push("body");}
        const responses=resolve(operation.responses??{}),success=Object.keys(responses).filter(key=>/^2\d\d$/.test(key)).sort()[0];
        const response=success?resolve(responses[success]):{},content=object(response.content)?response.content:{},media=object(content["application/json"])?content["application/json"]:{};
        const id=typeof operation.operationId==="string"?operation.operationId:`${method}-${path.replace(/[^A-Za-z0-9]/g,"-")}`;
        actions.push({id:id.slice(0,128),description:String(operation.summary??operation.description??`${method.toUpperCase()} ${path}`).slice(0,4000),method:method.toUpperCase() as ConnectionAction["method"],path:`${base.pathname.replace(/\/$/,"")}${path}`,effect:method==="get"?"read":"write",
          inputSchema:{type:"object",properties,required:requiredGroups,additionalProperties:false},outputSchema:media.schema?schema(media.schema):{},bindings:{path:Object.keys(grouped.path),query:Object.keys(grouped.query),body:hasBody}});
      }catch{warnings.push(`${method.toUpperCase()} ${path}: unsupported or invalid operation schema.`);}
    }
  }
  if(!actions.length)throw fail();
  return {manifest:validateConnectionManifest({name:options.name,kind:"http",baseUrl:base.origin,auth:options.auth??{kind:"none"},actions}),warnings};
}
