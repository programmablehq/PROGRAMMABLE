import { keccak256, recoverTypedDataAddress, parseSignature, toHex, getAddress } from 'viem';

const ORIGIN = 'https://api.hyperliquid.xyz';
const ZERO = '0x0000000000000000000000000000000000000000';

/** The canonical HyperCore EIP-712 action; it only changes this wallet's EVM block mode. */
export function hyperEvmBlockModeActionV1(enable, nonce, expiresAfter) {
  if (typeof enable !== 'boolean' || !Number.isSafeInteger(nonce) || nonce <= 0
    || !Number.isSafeInteger(expiresAfter) || expiresAfter <= nonce || expiresAfter - nonce > 60_000) throw new TypeError('HYPEREVM_ACTION_INVALID');
  const bytes = [];
  const string = value => { const data = new TextEncoder().encode(value); if (data.length > 31) throw new TypeError('HYPEREVM_ACTION_INVALID'); return [0xa0 + data.length, ...data]; };
  const uint64 = value => { const data = new Uint8Array(8); new DataView(data.buffer).setBigUint64(0, BigInt(value)); return [...data]; };
  bytes.push(0x82, ...string('type'), ...string('evmUserModify'), ...string('usingBigBlocks'), enable ? 0xc3 : 0xc2,
    ...uint64(nonce), 0, 0, ...uint64(expiresAfter));
  return { action: { type: 'evmUserModify', usingBigBlocks: enable }, nonce, expiresAfter,
    typedData: { domain: { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: ZERO },
      types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
      primaryType: 'Agent', message: { source: 'a', connectionId: keccak256(toHex(new Uint8Array(bytes))) } } };
}

/** No transaction or token approval is requested here. New Core accounts need the network's one-time activation first. */
export async function enableHyperEvmLargeTransactionsV1({ account, request, fetchImpl = fetch, now = () => Date.now() }) {
  const address = getAddress(account);
  if (await request({ method: 'eth_chainId' }) !== '0x3e7') throw new Error('HYPEREVM_CHAIN_MISMATCH');
  const enabled = await request({ method: 'eth_usingBigBlocks', params: [address] });
  if (enabled === true) return { enabled: true, changed: false };
  if (enabled !== false) throw new Error('HYPEREVM_BLOCK_MODE_UNAVAILABLE');
  const coreResponse=await fetchImpl(ORIGIN + '/info', {method:'POST',redirect:'error',headers:{'content-type':'application/json'},
    body:JSON.stringify({type:'userRole',user:address}),signal:AbortSignal.timeout(10_000)});
  const role=await coreResponse.json();
  if(!coreResponse.ok || typeof role?.role !== 'string') throw new Error('HYPEREVM_CORE_STATUS_UNAVAILABLE');
  if(role.role === 'missing') throw new Error('Activate this wallet on HyperCore once before launching on HyperEVM. HyperCore charges its $1 activation fee. Then retry this same approved launch.');
  const nonce = now();
  const prepared = hyperEvmBlockModeActionV1(true, nonce, nonce + 30_000);
  const signature = await request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify({
    ...prepared.typedData, types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], ...prepared.typedData.types },
  })] });
  if (getAddress(await recoverTypedDataAddress({ ...prepared.typedData, signature })) !== address) throw new Error('HYPEREVM_SIGNATURE_MISMATCH');
  const sig = parseSignature(signature);
  const response = await fetchImpl(ORIGIN + '/exchange', { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: prepared.action, nonce, expiresAfter: prepared.expiresAfter, vaultAddress: null,
      signature: { r: sig.r, s: sig.s, v: Number(sig.v) } }), signal: AbortSignal.timeout(15_000) });
  const result = await response.json();
  if (!response.ok || result?.status !== 'ok') {
    if (typeof result?.response === 'string' && result.response.includes('does not exist')) throw new Error('HYPEREVM_CORE_ACTIVATION_REQUIRED');
    throw new Error('HYPEREVM_BLOCK_MODE_REJECTED');
  }
  for(let attempt=0;attempt<10;attempt++) {
    if(await request({method:'eth_usingBigBlocks',params:[address]})===true) return {enabled:true,changed:true};
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('HYPEREVM_BLOCK_MODE_PENDING');
}
