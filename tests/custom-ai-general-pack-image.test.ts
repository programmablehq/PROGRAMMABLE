import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({blob:vi.fn()}));
vi.mock("../app/api/token-image/handler",()=>({readProductionTokenImageBlobV1:mock.blob}));
import {readOwnedGeneralPackImage} from "../lib/custom-ai/general-pack-image.server";
import type {AIStore} from "../lib/custom-ai/store.server";
import {PROGRAMMABLE_TOKEN_IMAGE_HOST} from "../lib/token-image";
const sha=(v:Uint8Array|string)=>createHash("sha256").update(v).digest("hex"),owner="image-owner",bytes=Buffer.from("already-verified-immutable-fixture");
const hash=sha(bytes),id=sha(`${owner}:${hash}`),image={id,hash,url:`https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/custom-ai-${id}.webp`};
let read:ReturnType<typeof vi.fn>,store:AIStore;
beforeEach(()=>{vi.clearAllMocks();read=vi.fn().mockResolvedValue({value:image});store={readObject:read} as unknown as AIStore;
  mock.blob.mockResolvedValue({bytes,contentType:"image/webp"});});
describe("owned bounded launch image read",()=>{
  it("requires the original owner, hash-derived image identity and fixed public host before fetching",async()=>{
    for(const [account,candidate] of [["other-owner",image],[owner,{...image,url:"https://example.com/foreign.webp"}],[owner,{...image,id:"f".repeat(64)}]] as const)
      await expect(readOwnedGeneralPackImage(store,account,candidate,new AbortController().signal)).rejects.toMatchObject({code:"launch-image"});
    expect(read).not.toHaveBeenCalled();expect(mock.blob).not.toHaveBeenCalled();
  });
  it("requires the exact saved owned upload receipt without fetching a missing or changed record",async()=>{
    read.mockResolvedValueOnce(null).mockResolvedValueOnce({value:{...image,hash:"f".repeat(64)}});
    for(let i=0;i<2;i++)await expect(readOwnedGeneralPackImage(store,owner,image,new AbortController().signal)).rejects.toMatchObject({code:"launch-image"});
    expect(mock.blob).not.toHaveBeenCalled();
  });
  it("checks the immutable bytes and passes the fixed receipt to the bounded existing blob reader",async()=>{
    expect(await readOwnedGeneralPackImage(store,owner,image,new AbortController().signal)).toEqual(bytes);
    expect(read).toHaveBeenCalledWith(owner,"image",id);expect(mock.blob.mock.calls[0][0]).toMatchObject({url:image.url,pathname:`token-images/custom-ai-${id}.webp`});
    mock.blob.mockResolvedValue({bytes:Buffer.from("changed"),contentType:"image/webp"});
    await expect(readOwnedGeneralPackImage(store,owner,image,new AbortController().signal)).rejects.toMatchObject({code:"launch-image"});
  });
  it("keeps temporary provider details private and never automatically retries",async()=>{
    mock.blob.mockRejectedValue(new Error("private provider diagnostics"));
    await expect(readOwnedGeneralPackImage(store,owner,image,new AbortController().signal)).rejects.toMatchObject({code:"launch-image-unavailable",status:503});
    expect(mock.blob).toHaveBeenCalledTimes(1);
  });
});
