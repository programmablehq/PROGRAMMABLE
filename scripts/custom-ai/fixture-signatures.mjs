// Public, deterministic fixture keys only. This module runs exclusively inside
// the networkless EVM child process and never accepts keys from a project.
export function createFixtureSignatures(requireTool, chainId) {
  const {privateKeyToAccount}=requireTool("viem/accounts");
  const actors=Object.fromEntries(["signer-issuer","signer-player-a","signer-player-b"].map((name,index)=>
    [name,privateKeyToAccount("0x"+String(index+1).repeat(64))]));
  const accounts=Object.fromEntries(Object.entries(actors).map(([name,account])=>[name,account.address]));
  const signatures=new Map();
  const fields={
    "wallet-link":[["bindingId","bytes32"],["player","address"],["playerIdHash","bytes32"],["nonce","bytes32"],["validUntil","uint64"]],
    "game-event":[["bindingId","bytes32"],["eventId","bytes32"],["playerIdHash","bytes32"],["player","address"],["sequence","uint64"],["score","uint256"],["observedAt","uint64"],["validUntil","uint64"]],
  };
  async function prepare(inputs,value,deployed,depth=0){
    if(depth>8)throw Error("Local signature nesting limit");
    for(const input of inputs){
      if(Array.isArray(input)){await prepare(input,value,deployed,depth+1);continue;}
      if(!input||typeof input!=="object"||!Object.hasOwn(input,"signature"))continue;
      const spec=input.signature,key=JSON.stringify(spec);
      if(signatures.has(key))continue;
      if(signatures.size>=128||!Object.hasOwn(actors,spec.signer)||!Object.hasOwn(fields,spec.kind)||!deployed.has(spec.contract))throw Error("Invalid local signature reference");
      const declaration=fields[spec.kind],values=spec.values.map(value);
      if(values.length!==declaration.length)throw Error("Invalid local signature fields");
      const primaryType=spec.kind==="wallet-link"?"WalletLink":"GameEvent";
      const types={[primaryType]:declaration.map(([name,type])=>({name,type}))};
      const message=Object.fromEntries(declaration.map(([name],index)=>[name,values[index]]));
      const domain={name:"Programmable Project Events",version:"1",chainId:spec.chainId??chainId,verifyingContract:deployed.get(spec.contract).address};
      signatures.set(key,await actors[spec.signer].signTypedData({domain,types,primaryType,message}));
    }
  }
  function read(spec){const result=signatures.get(JSON.stringify(spec));if(!result)throw Error("Unprepared local signature");return result;}
  return {accounts,prepare,read};
}
