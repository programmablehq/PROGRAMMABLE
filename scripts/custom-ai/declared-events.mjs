/** Compare executed EVM logs, never an ABI declaration or a getter. Unrelated
 * emitter/signature pairs are ignored; each declared pair is exact and ordered. */
export function declaredEventsMatch(expectations, logs, deployed, resolve, codec) {
 const {parseAbi,encodeEventTopics,encodeAbiParameters,bytesToHex}=codec;
 const expected=expectations.map(event=>{
  const abi=parseAbi([event.signature]),item=abi[0],args=event.arguments.map(resolve);
  const target=deployed.get(event.contract);
  if(!target)throw Error("The declared event emitter is not deployed.");
  const topics=encodeEventTopics({abi,eventName:item.name,args:args.filter((_,index)=>item.inputs[index].indexed)});
  if(topics.some(topic=>typeof topic!=="string"))throw Error("The declared event topics must be exact values.");
  const data=encodeAbiParameters(item.inputs.filter(input=>!input.indexed),args.filter((_,index)=>!item.inputs[index].indexed));
  return {address:target.address.toLowerCase(),topics:topics.map(topic=>topic.toLowerCase()),data:data.toLowerCase()};
 });
 const observed=logs.map(([address,topics,data])=>({address:bytesToHex(address).toLowerCase(),topics:topics.map(topic=>bytesToHex(topic).toLowerCase()),data:bytesToHex(data).toLowerCase()}))
  .filter(log=>expected.some(event=>event.address===log.address&&event.topics[0]===log.topics[0]));
 return observed.length===expected.length&&observed.every((log,index)=>{
  const event=expected[index];
  return log.address===event.address&&log.data===event.data&&log.topics.length===event.topics.length&&log.topics.every((topic,index)=>topic===event.topics[index]);
 });
}
