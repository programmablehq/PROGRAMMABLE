import { createRequire } from "node:module";
import { join } from "node:path";
const requireTool = createRequire(join(process.argv[2], "package.json"));
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; if (Buffer.byteLength(input) > 6_000_000) process.exit(3); });
process.stdin.on("end", async () => {
  try { process.stdout.write(JSON.stringify(await materialize(JSON.parse(input)))); }
  catch { process.exitCode = 4; }
});

/** V2 admits only predeclared, source-bound CREATE children. Unknown creation,
 * delegate calls and external state remain unsupported rather than fabricated. */
async function materialize({ chainId, evmVersion, controller, deployer, targets, constructorChildren, includeConstructionGas = false }) {
  const { createVM } = requireTool("@ethereumjs/vm"), { createCustomCommon, Mainnet, Hardfork } = requireTool("@ethereumjs/common");
  const { createBlock } = requireTool("@ethereumjs/block"), { createAddressFromString, createAccount, hexToBytes, bytesToHex } = requireTool("@ethereumjs/util");
  const { keccak256 } = requireTool("viem");
  if (![1, 4663, 8453, 999].includes(chainId) || !["paris", "cancun"].includes(evmVersion) || !Array.isArray(targets) || targets.length < 3
    || !Array.isArray(constructorChildren) || !constructorChildren.length || targets.length + constructorChildren.length > 16) throw Error();
  const rootIds = new Set(targets.map(target => target.id)), allIds = new Set(rootIds), rootForChild = new Map();
  for (const child of constructorChildren) {
    if (allIds.has(child.id) || !allIds.has(child.parent) || child.creation !== "create") throw Error();
    rootForChild.set(child.id, rootIds.has(child.parent) ? child.parent : rootForChild.get(child.parent)); allIds.add(child.id);
  }
  const creationCode=new Map([...targets,...constructorChildren].map(target=>[target.id,hexToBytes(target.initCode)]));
  const common = createCustomCommon({ chainId }, Mainnet, { hardfork: evmVersion === "cancun" ? Hardfork.Cancun : Hardfork.Paris });
  const failures = [], observations = [], constructionGas = new Map(); let totalGas = 0n;
  const ambientOpcodes=new Set(["BLOCKHASH","BLOBHASH","BLOBBASEFEE","TIMESTAMP","NUMBER","COINBASE","PREVRANDAO","DIFFICULTY","BASEFEE","GASPRICE","GASLIMIT","GAS","ORIGIN","BALANCE","SELFBALANCE"]);
  const unsupportedOpcodes=new Set(["SELFDESTRUCT","CALLCODE","DELEGATECALL"]),codeOpcodes=new Set(["EXTCODESIZE","EXTCODECOPY","EXTCODEHASH"]);
  const fail = (target, code) => { if (failures.length < 16 && !failures.some(f => f.target === target && f.code === code)) failures.push({ target, code }); };
  function runtime(target, actual) {
    const template = hexToBytes(target.runtimeTemplate);
    if (!actual.length || actual.length !== template.length || actual.length > 24_576) { fail(target.id, "runtime-template-mismatch"); return; }
    const covered = new Uint8Array(actual.length), words = [];
    for (const [immutableId, ranges] of Object.entries(target.immutableReferences)) {
      let word;
      if (!/^(?:0|[1-9][0-9]*)$/.test(immutableId) || !Array.isArray(ranges) || !ranges.length) throw Error();
      for (const range of ranges) {
        if (!Number.isSafeInteger(range.start) || range.start < 0 || range.length !== 32 || range.start + 32 > actual.length) throw Error();
        for (let i = range.start; i < range.start + 32; i++) { if (covered[i] || template[i] !== 0) throw Error(); covered[i] = 1; }
        const next = bytesToHex(actual.slice(range.start, range.start + 32));
        if (word !== undefined && next !== word) { fail(target.id, "immutable-word-mismatch"); return; } word = next;
      }
      words.push({ immutableId, abiType: "bytes32", literal: word });
    }
    if (actual.some((byte, index) => !covered[index] && byte !== template[index])) { fail(target.id, "runtime-template-mismatch"); return; }
    return { id: target.id, runtimeCode: bytesToHex(actual), runtimeCodeHash: keccak256(actual), runtimeImmutables: words.sort((a, b) => Number(a.immutableId) - Number(b.immutableId)) };
  }
  for (let pass = 0; pass < 2; pass++) {
    const vm = await createVM({ common }), deployed = new Set(), deployedCode = new Map(), frames = [], observedChildren = new Map(), nextChild = new Map();
    let current, forbidden = false;
    for (const address of new Set([controller, deployer])) await vm.stateManager.putAccount(createAddressFromString(address), createAccount({ balance: 10n ** BigInt(24 + pass) }));
    vm.evm.events?.on("beforeMessage", message => {
      if (message.depth === 0) { frames.push({ kind: "create", target: current }); return; }
      const parent = frames.at(-1);
      if (!message.to && !message.delegatecall) {
        const expected = parent?.kind === "create" ? constructorChildren.filter(child => child.parent === parent.target.id)[nextChild.get(parent.target.id) ?? 0] : undefined;
        if (!expected || message.salt !== undefined || message.caller.toString().toLowerCase() !== parent.target.address.toLowerCase()
          || keccak256(message.data) !== keccak256(expected.initCode) || message.value !== BigInt(expected.value)) {
          forbidden = true; fail(current.id, "unbound-constructor-child"); frames.push({ kind: "forbidden" }); return;
        }
        nextChild.set(parent.target.id, (nextChild.get(parent.target.id) ?? 0) + 1);
        frames.push({ kind: "create", target: expected }); return;
      }
      frames.push({ kind: "call" });
      const address = message.to?.toString().toLowerCase();
      if (!message.delegatecall && address && (BigInt(address) > 0n && BigInt(address) <= 10n || deployed.has(address))) return;
      forbidden = true; fail(current.id, "constructor-needs-chain-state");
    });
    vm.evm.events?.on("afterMessage", result => {
      const frame = frames.pop();
      if (frame?.kind !== "create" || rootIds.has(frame.target.id)) return;
      const child = frame.target;
      if (result.execResult.exceptionError || result.createdAddress?.toString().toLowerCase() !== child.address.toLowerCase() || observedChildren.has(child.id)) {
        forbidden = true; fail(child.id, "constructor-child-execution"); return;
      }
      const actual = runtime(child, Uint8Array.from(result.execResult.returnValue));
      if (!actual) { forbidden = true; return; }
      observedChildren.set(child.id, { ...actual, parent: child.parent, nonce: child.nonce, address: child.address });
      deployed.add(child.address.toLowerCase());
      deployedCode.set(child.address.toLowerCase(),hexToBytes(actual.runtimeCode));
    });
    vm.evm.events?.on("step", step => {
      const name=step.opcode.name;let forwardsGas=false;
      if(name==="GAS") {
        const frame=frames.at(-1),address=(step.codeAddress??step.address).toString().toLowerCase();
        const code=frame?.kind==="create"?creationCode.get(frame.target.id):deployedCode.get(address);
        forwardsGas=code?.[step.pc]===0x5a&&(code[step.pc+1]===0xf1||code[step.pc+1]===0xfa);
      }
      if(unsupportedOpcodes.has(name)) { forbidden=true;fail(current.id,"unbound-constructor-execution"); }
      if (ambientOpcodes.has(name)&&!forwardsGas) {
        forbidden = true; fail(current.id, "constructor-needs-chain-state");
      }
      if (codeOpcodes.has(name)) {
        const address = `0x${(step.stack.at(-1) & ((1n << 160n) - 1n)).toString(16).padStart(40, "0")}`;
        if (!deployed.has(address)) { forbidden = true; fail(current.id, "constructor-needs-chain-state"); }
      }
    });
    const runtimes = [];
    for (const target of targets) {
      current = target; forbidden = false;
      const address = createAddressFromString(target.address);
      await vm.stateManager.putAccount(address, createAccount({ balance: BigInt(pass) }));
      await vm.evm.journal.cleanup(); vm.stateManager.originalStorageCache.clear();
      const gasLimit = pass ? 14_000_000n : 15_000_000n;
      if (totalGas + gasLimit > 200_000_000n) { fail(current.id, "constructor-gas-budget"); break; }
      const result = await vm.evm.runCall({ caller: createAddressFromString(deployer), origin: createAddressFromString(controller), data: hexToBytes(target.initCode),
        salt: hexToBytes(target.salt), value: BigInt(target.value), gasLimit, gasPrice: BigInt(pass + 1),
        block: createBlock({ header: { number: BigInt(100 + pass), timestamp: 1_800_000_000n + BigInt(pass), gasLimit: 30_000_000n,
          baseFeePerGas: BigInt(pass + 1), coinbase: pass ? "0x3000000000000000000000000000000000000003" : "0x0000000000000000000000000000000000000000",
          mixHash: hexToBytes(`0x${(pass ? "11" : "00").repeat(32)}`) } }, { common }) });
      totalGas += result.execResult.executionGasUsed;
      if (includeConstructionGas) { const used = result.execResult.executionGasUsed; constructionGas.set(target.id, used > (constructionGas.get(target.id) ?? 0n) ? used : constructionGas.get(target.id)); }
      if (forbidden || failures.length) break;
      if (frames.length || result.execResult.exceptionError || result.createdAddress?.toString().toLowerCase() !== target.address.toLowerCase()) { fail(current.id, "constructor-execution"); break; }
      if (constructorChildren.some(child => rootForChild.get(child.id) === target.id && !observedChildren.has(child.id))) { fail(current.id, "constructor-child-missing"); break; }
      const actual = runtime(target, await vm.stateManager.getCode(address)); if (!actual) break;
      runtimes.push(actual); deployed.add(target.address.toLowerCase());deployedCode.set(target.address.toLowerCase(),hexToBytes(actual.runtimeCode));
    }
    if (!failures.length) {
      for(const target of targets) {
        if(bytesToHex(await vm.stateManager.getCode(createAddressFromString(target.address)))!==runtimes.find(runtime=>runtime.id===target.id)?.runtimeCode) {
          fail(target.id,"constructor-source-state-changed");break;
        }
      }
      for (const child of constructorChildren) {
        const observed = observedChildren.get(child.id);
        if (!observed || bytesToHex(await vm.stateManager.getCode(createAddressFromString(child.address))) !== observed.runtimeCode) { fail(child.id, "constructor-child-state-changed"); break; }
      }
    }
    observations.push({ contracts: runtimes, children: constructorChildren.map(child => observedChildren.get(child.id)) }); if (failures.length) break;
  }
  if (!failures.length && JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) fail("graph", "environment-dependent-runtime");
  return { status: failures.length ? "needs-context" : "materialized", passes: observations.length, gasUsed: totalGas.toString(), failures,
    contracts: failures.length ? [] : observations[0].contracts, children: failures.length ? [] : observations[0].children,
    ...(includeConstructionGas ? { constructionGas: targets.map(target => ({ targetId: target.id, maximumGasUsed: (constructionGas.get(target.id) ?? 0n).toString() })) } : {}) };
}
