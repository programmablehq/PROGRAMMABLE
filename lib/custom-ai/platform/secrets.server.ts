import "server-only";
import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {ProjectError,type JsonValue} from "./types";
export type ProjectKeyring={active:string;keys:Record<string,Buffer>};
export function readProjectKeyring():ProjectKeyring{
  try{const raw=JSON.parse(process.env.PROJECT_CONNECTION_KEYRING??"{}");if(typeof raw.active!=="string"||!raw.keys||typeof raw.keys!=="object")throw Error();
    const keys=Object.fromEntries(Object.entries(raw.keys).map(([id,value])=>{if(!/^[A-Za-z0-9-]{1,32}$/.test(id)||typeof value!=="string")throw Error();const bytes=Buffer.from(value,"base64");if(bytes.length!==32||bytes.toString("base64")!==value)throw Error();return [id,bytes];}));
    if(!keys[raw.active])throw Error();return {active:raw.active,keys};
  }catch{throw new ProjectError("private-configuration","Private project storage is temporarily unavailable.",503);}
}
export function createProjectSecretBox(source:ProjectKeyring){
  const keys=Object.fromEntries(Object.entries(source.keys).map(([id,key])=>[id,Buffer.from(key)])),active=source.active;
  if(!keys[active]||Object.values(keys).some(key=>key.length!==32))throw new TypeError("Invalid private storage keyring");
  return {
    seal(purpose:string,value:JsonValue){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",keys[active],iv);cipher.setAAD(Buffer.from(`programmable-private-v1\0${purpose}`));return `${active}.${Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString("base64")}`;},
    open(purpose:string,envelope:string):JsonValue{
      try{const [id,payload]=envelope.split(".");if(!keys[id]||!payload)throw Error();const bytes=Buffer.from(payload,"base64"),decipher=createDecipheriv("aes-256-gcm",keys[id],bytes.subarray(0,12));decipher.setAAD(Buffer.from(`programmable-private-v1\0${purpose}`));decipher.setAuthTag(bytes.subarray(-16));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString("utf8"));}
      catch{throw new ProjectError("private-storage","The saved private capability could not be opened.",503);}
    },
  };
}
