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

/** Execute only exact owned creation bytes in an in-memory EVM. Unknown chain
 * state is never replaced with a successful dependency observation. */
async function materialize({ chainId, evmVersion, controller, deployer, targets }) {
  const { createVM } = requireTool("@ethereumjs/vm"), { createCustomCommon, Mainnet, Hardfork } = requireTool("@ethereumjs/common");
  const { createBlock } = requireTool("@ethereumjs/block"), { createAddressFromString, createAccount, hexToBytes, bytesToHex } = requireTool("@ethereumjs/util");
  const { keccak256 } = requireTool("viem");
  if (![1,4663,8453,999].includes(chainId) || !["paris","cancun"].includes(evmVersion) || !Array.isArray(targets) || !targets.length || targets.length > 16) throw Error();
  const common = createCustomCommon({ chainId }, Mainnet, { hardfork: evmVersion === "cancun" ? Hardfork.Cancun : Hardfork.Paris });
  const failures = [], observations = []; let totalGas = 0n;
  const fail = (target, code) => { if (failures.length < 16 && !failures.some(f => f.target === target && f.code === code)) failures.push({ target, code }); };
  for (let pass = 0; pass < 2; pass++) {
    const vm = await createVM({ common }), deployed = new Set(); let current = "setup", forbidden = false;
    for (const address of new Set([controller, deployer])) await vm.stateManager.putAccount(createAddressFromString(address), createAccount({ balance: 10n ** BigInt(24 + pass) }));
    vm.evm.events?.on("beforeMessage", message => {
      if (message.depth === 0) return;
      if (!message.to || message.delegatecall) { forbidden = true; fail(current, "unbound-constructor-execution"); return; }
      const address = message.to.toString().toLowerCase();
      if (BigInt(address) > 0n && BigInt(address) <= 10n || deployed.has(address)) return;
      forbidden = true; fail(current, "constructor-needs-chain-state");
    });
    vm.evm.events?.on("step", step => {
      const name = step.opcode.name;
      // Two sampled blocks cannot prove independence from arbitrary future
      // context. Refuse actual reads of unbound environment, including origin
      // (which need not equal a smart-account controller) and ambient balances.
      if (["BLOCKHASH","BLOBHASH","BLOBBASEFEE","TIMESTAMP","NUMBER","COINBASE","PREVRANDAO","DIFFICULTY","BASEFEE","GASPRICE","GASLIMIT","GAS","ORIGIN","BALANCE","SELFBALANCE"].includes(name)) {
        forbidden = true; fail(current, "constructor-needs-chain-state");
      }
      if (["EXTCODESIZE","EXTCODECOPY","EXTCODEHASH"].includes(name)) {
        const address = `0x${(step.stack.at(-1) & ((1n << 160n) - 1n)).toString(16).padStart(40,"0")}`;
        if (!deployed.has(address)) { forbidden = true; fail(current, "constructor-needs-chain-state"); }
      }
    });
    const runtimes = [];
    for (const target of targets) {
      current = target.id; forbidden = false;
      const address = createAddressFromString(target.address);
      // Changing a counterfactual address's synthetic balance also exposes an
      // immutable depending on ambient pre-deployment funds in these probes.
      await vm.stateManager.putAccount(address, createAccount({ balance: BigInt(pass) }));
      await vm.evm.journal.cleanup(); vm.stateManager.originalStorageCache.clear();
      const gasLimit = pass ? 14_000_000n : 15_000_000n;
      if (totalGas + gasLimit > 200_000_000n) { fail(current, "constructor-gas-budget"); break; }
      const result = await vm.evm.runCall({ caller: createAddressFromString(deployer), origin: createAddressFromString(controller),
        data: hexToBytes(target.initCode), salt: hexToBytes(target.salt), value: BigInt(target.value), gasLimit, gasPrice: BigInt(pass + 1),
        block: createBlock({ header: { number: BigInt(100 + pass), timestamp: 1_800_000_000n + BigInt(pass), gasLimit: 30_000_000n,
          baseFeePerGas: BigInt(pass + 1), coinbase: pass ? "0x3000000000000000000000000000000000000003" : "0x0000000000000000000000000000000000000000",
          mixHash: hexToBytes(`0x${(pass ? "11" : "00").repeat(32)}`) } }, { common }) });
      totalGas += result.execResult.executionGasUsed;
      if (forbidden) break;
      if (result.execResult.exceptionError || result.createdAddress?.toString().toLowerCase() !== target.address.toLowerCase()) { fail(current, "constructor-execution"); break; }
      const actual = await vm.stateManager.getCode(address), template = hexToBytes(target.runtimeTemplate);
      if (actual.length !== template.length || !actual.length) { fail(current, "runtime-template-mismatch"); break; }
      const covered = new Uint8Array(actual.length), words = [];
      for (const [immutableId, ranges] of Object.entries(target.immutableReferences)) {
        let word;
        if (!/^(?:0|[1-9][0-9]*)$/.test(immutableId) || !Array.isArray(ranges) || !ranges.length) throw Error();
        for (const range of ranges) {
          if (!Number.isSafeInteger(range.start) || range.start < 0 || range.length !== 32 || range.start + 32 > actual.length) throw Error();
          for (let i = range.start; i < range.start + 32; i++) { if (covered[i] || template[i] !== 0) throw Error(); covered[i] = 1; }
          const next = bytesToHex(actual.slice(range.start, range.start + 32));
          if (word !== undefined && next !== word) { fail(current, "immutable-word-mismatch"); break; }
          word = next;
        }
        words.push({ immutableId, abiType: "bytes32", literal: word });
      }
      if (failures.length) break;
      if (actual.some((byte, index) => !covered[index] && byte !== template[index])) { fail(current, "runtime-template-mismatch"); break; }
      runtimes.push({ id: target.id, runtimeCode: bytesToHex(actual), runtimeCodeHash: keccak256(actual),
        runtimeImmutables: words.sort((a,b) => Number(a.immutableId) - Number(b.immutableId)) });
      deployed.add(target.address.toLowerCase());
    }
    observations.push(runtimes); if (failures.length) break;
  }
  if (!failures.length && JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) fail("graph", "environment-dependent-runtime");
  return { status: failures.length ? "needs-context" : "materialized", passes: observations.length, gasUsed: totalGas.toString(), failures,
    contracts: failures.length ? [] : observations[0] };
}
