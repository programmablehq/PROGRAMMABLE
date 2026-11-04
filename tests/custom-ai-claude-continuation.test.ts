import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("../lib/custom-ai/provider-health.server",()=>({providerHealth:()=>({assertAvailable:async()=>{},fail:async()=>{}})}));
import {callClaude,type ClaudeInput} from "../lib/custom-ai/claude.server";
import {ModelResponseError} from "../lib/custom-ai/model-response";
const input:ClaudeInput={model:"fixture-model",system:"Return the declared source",messages:[{role:"user",content:"Build the saved source"}],schema:{},maxTokens:100,responseProfile:"contract"};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("Anthropic resumable responses",()=>{
  it.each([false,true])("preserves partial declaration and usage for truncated stream=%s",async streamed=>{
    vi.stubEnv("ANTHROPIC_API_KEY","synthetic-local-fixture");
    const text='{"steps":[';
    vi.stubGlobal("fetch",vi.fn(async()=>streamed?new Response([
      {type:"message_start",message:{usage:{input_tokens:12}}},
      {type:"content_block_delta",delta:{type:"text_delta",text}},
      {type:"message_delta",delta:{stop_reason:"max_tokens"},usage:{output_tokens:100}},
      {type:"message_stop"}
    ].map(event=>`data: ${JSON.stringify(event)}\n\n`).join(""),{headers:{"content-type":"text/event-stream"}}):Response.json({content:[{type:"text",text}],stop_reason:"max_tokens",usage:{input_tokens:12,output_tokens:100}})));
    const error=await callClaude({...input,captureIncompleteDeclaration:true}).catch(error=>error);
    expect(error).toBeInstanceOf(ModelResponseError);expect(error).toMatchObject({failure:"output-limit",usage:{inputTokens:12,outputTokens:100},partialDeclaration:text});
    expect(JSON.stringify(error)).not.toContain(text);
  });
  it("treats a lost stream terminator as resumable without exposing source text",async()=>{
    vi.stubEnv("ANTHROPIC_API_KEY","synthetic-local-fixture");
    vi.stubGlobal("fetch",async()=>new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"private-source"}}\n\n',{headers:{"content-type":"text/event-stream"}}));
    const error=await callClaude(input).catch(error=>error);
    expect(error).toBeInstanceOf(ModelResponseError);expect(error.failure).toBe("missing-end");expect(error).not.toHaveProperty("partialDeclaration");
  });
});
