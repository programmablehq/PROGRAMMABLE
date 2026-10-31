import "server-only";
import { createHash } from "node:crypto";
import { readProductionTokenImageBlobV1 } from "@/app/api/token-image/handler";
import { PROGRAMMABLE_TOKEN_IMAGE_HOST } from "@/lib/token-image";
import type { AIStore } from "./store.server";
import { CustomAIError } from "./types";

type Image={id:string;hash:string;url:string};
const sha=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
export async function readOwnedGeneralPackImage(store:AIStore,owner:string,image:Image,signal:AbortSignal) {
  image=structuredClone(image);signal.throwIfAborted();
  const pathname=`token-images/custom-ai-${image.id}.webp`, url=`https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/${pathname}`;
  const invalid=()=>new CustomAIError("launch-image","The saved coin image could not be verified. Choose it again before preparing this launch.",422);
  if(!/^[a-f0-9]{64}$/u.test(image.id)||!/^[a-f0-9]{64}$/u.test(image.hash)||sha(`${owner}:${image.hash}`)!==image.id||image.url!==url)throw invalid();
  const receipt=await store.readObject<Image>(owner,"image",image.id);
  if(!receipt||receipt.value.id!==image.id||receipt.value.hash!==image.hash||receipt.value.url!==url)throw invalid();
  try {
    const result=await readProductionTokenImageBlobV1({url,pathname,downloadUrl:url,contentType:"image/webp",contentDisposition:"inline",etag:""},
      AbortSignal.any([signal,AbortSignal.timeout(5000)]));
    if(result.contentType!=="image/webp"||sha(result.bytes)!==image.hash)throw invalid();
    return result.bytes;
  }catch(error){
    if(error instanceof CustomAIError)throw error;
    throw new CustomAIError("launch-image-unavailable","The saved coin image is temporarily unavailable. Your source is kept.",503);
  }
}
