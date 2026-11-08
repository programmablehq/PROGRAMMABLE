import "server-only";
import { createHash,randomBytes } from "node:crypto";
import type { createConnectionStore } from "./connections.server";
import { privateConnectorHTTP,validateConnectorURL,type ConnectorTransport } from "./private-http.server";
import { ProjectError,type ProjectScope } from "./types";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const fail=()=>new ProjectError("oauth-response","Sign-in could not be completed. Start again from the connection.",502);
export function createProjectOAuth(store:ReturnType<typeof createConnectionStore>,publicOrigin:string,transport:ConnectorTransport=privateConnectorHTTP,now=Date.now){
  const origin=validateConnectorURL(publicOrigin);if(origin.pathname!=="/"||origin.search)throw new TypeError("Use the public platform origin");
  const redirectUri=new URL("/api/custom-ai/platform/connections/oauth/callback",origin).href;
  async function exchange(tokenUrl:string,params:URLSearchParams,secret:Record<string,string>,signal?:AbortSignal){
    if(secret.clientSecret)params.set("client_secret",secret.clientSecret);
    const result=await transport({url:tokenUrl,method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:params.toString(),...(signal?{signal}:{})});
    if(result.status!==200)throw fail();
    let tokens;try{tokens=JSON.parse(result.text);}catch{throw fail();}
    if(typeof tokens.access_token!=="string"||!tokens.access_token||tokens.access_token.length>16000||/[\r\n\0]/.test(tokens.access_token)
      ||tokens.token_type&&String(tokens.token_type).toLowerCase()!=="bearer"||tokens.refresh_token&&typeof tokens.refresh_token!=="string")throw fail();
    const expires=Number(tokens.expires_in??3600);if(!Number.isFinite(expires)||expires<=0||expires>31536000)throw fail();
    return {...secret,accessToken:tokens.access_token,...(tokens.refresh_token?{refreshToken:tokens.refresh_token}:{}),tokenExpiresAt:String(now()+expires*1000)};
  }
  async function start(scope:ProjectScope,connectionId:string){
    const connection=await store.privateConnection(scope,connectionId),auth=connection.manifest.auth;
    if(auth.kind!=="oauth2"||connection.state==="revoked")throw new ProjectError("oauth-connection","Choose an active OAuth connection.",409);
    const state=randomBytes(32).toString("base64url"),verifier=randomBytes(32).toString("base64url");
    const expiresAt=new Date(now()+600000).toISOString();
    await store.saveOAuthState(scope,connectionId,hash(state),{verifier,redirectUri,version:connection.version},expiresAt);
    const url=validateConnectorURL(auth.authorizeUrl);
    for(const[key,value]of Object.entries({response_type:"code",client_id:auth.clientId,redirect_uri:redirectUri,scope:auth.scopes.join(" "),state,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256"}))url.searchParams.set(key,value);
    return {url:url.href,expiresAt};
  }
  async function complete(ownerId:string,state:string,code:string,signal?:AbortSignal){
    if(!/^[A-Za-z0-9_-]{43}$/.test(state)||typeof code!=="string"||!code||code.length>4096)throw new ProjectError("oauth-state","Use a valid sign-in callback.",403);
    const saved=await store.consumeOAuthState(ownerId,hash(state)),connection=await store.privateConnection(saved,saved.connectionId),auth=connection.manifest.auth;
    if(auth.kind!=="oauth2"||connection.version!==saved.payload.version||connection.state==="revoked"||saved.payload.redirectUri!==redirectUri)throw new ProjectError("oauth-state","The connection changed while signing in.",409);
    const params=new URLSearchParams({grant_type:"authorization_code",code,client_id:auth.clientId,redirect_uri:redirectUri,code_verifier:saved.payload.verifier});
    const secret=await exchange(auth.tokenUrl,params,connection.secret,signal);
    await store.rotateSecret(saved,saved.connectionId,connection.version,secret);
    return {projectId:saved.projectId,connectionId:saved.connectionId,connected:true};
  }
  async function refresh(scope:ProjectScope,connectionId:string,version:string,signal?:AbortSignal){
    const connection=await store.privateConnection(scope,connectionId),auth=connection.manifest.auth;
    if(connection.version!==version||connection.state!=="active")throw new ProjectError("connection-revoked","The connection is no longer active.",409);
    if(auth.kind!=="oauth2"||!connection.secret.tokenExpiresAt||Number(connection.secret.tokenExpiresAt)>now()+30000)return;
    if(!connection.secret.refreshToken)throw new ProjectError("oauth-expired","Sign in to this connection again.",409);
    const secret=await exchange(auth.tokenUrl,new URLSearchParams({grant_type:"refresh_token",refresh_token:connection.secret.refreshToken,client_id:auth.clientId}),connection.secret,signal);
    await store.rotateSecret(scope,connectionId,version,secret);
  }
  return {start,complete,refresh};
}
