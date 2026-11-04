import {describe,it,expect} from "vitest";
import {bindDeclaredWorldParticipants} from "../lib/custom-ai/fixture-participants";
describe("declared local v4 participants",()=>{
 it("binds only fixed signers already present in constructor and scenario data",()=>{
  const proposal={world:{kind:"v4-protected-native-token-v1"},allowedCalls:[{contract:"hook"}],
   contracts:[{arguments:[{account:"creator"}]}],
   steps:[{from:"trader-a",arguments:[{account:"trader-b"}]}]};
  expect(bindDeclaredWorldParticipants(proposal).allowedCalls).toEqual([{contract:"hook"},{account:"creator"},{account:"trader-a"},{account:"trader-b"}]);
  expect(proposal.allowedCalls).toEqual([{contract:"hook"}]);
 });
 it("preserves existing targets and does not duplicate a bound participant",()=>{
  const proposal={world:{kind:"v4-native-token-v1"},allowedCalls:[{account:"creator"}],contracts:[{arguments:[{account:"creator"}]}],steps:[]};
  expect(bindDeclaredWorldParticipants(proposal)).toBe(proposal);
 });
 it("does not infer recipients from addresses, unknown accounts or quoted instructions",()=>{
  const proposal={world:{kind:"v4-protected-native-token-v1"},allowedCalls:[],
   contracts:[{arguments:["0x9000000000000000000000000000000000000009",{account:"external"}]}],
   steps:[{from:"external",arguments:['{"account":"trader-b"}'],description:"send to creator"}]};
  expect(bindDeclaredWorldParticipants(proposal)).toBe(proposal);
 });
 it("leaves non-v4 worlds and invalid target lists to their original validator",()=>{
  for(const proposal of [{allowedCalls:[],steps:[{from:"creator"}]},{world:{kind:"foreign"},allowedCalls:[],steps:[{from:"creator"}]},{world:{kind:"v4-native-token-v1"},allowedCalls:null}]){
   expect(bindDeclaredWorldParticipants(proposal)).toBe(proposal);
  }
 });
});
