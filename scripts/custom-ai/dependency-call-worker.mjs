import { createRequire } from "node:module";
import { join } from "node:path";
const requireTool = createRequire(join(process.argv[2], "package.json"));
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; if (Buffer.byteLength(input) > 400_000) process.exit(3); });
process.stdin.on("end", async () => {
  try { process.stdout.write(JSON.stringify(await replay(JSON.parse(input)))); }
  catch { process.exitCode = 4; }
});

async function replay({ chainId, accounts, call, expectedOutput }) {
  const { createVM } = requireTool("@ethereumjs/vm"), { createCustomCommon, Mainnet, Hardfork } = requireTool("@ethereumjs/common");
  const { createAddressFromString, createAccount, hexToBytes, bytesToHex } = requireTool("@ethereumjs/util");
  const { keccak256 } = requireTool("viem");
  const address = /^0x(?!0{40}$)[a-f0-9]{40}$/, word = /^0x[a-f0-9]{64}$/;
  if (![1, 4663, 8453, 999].includes(chainId) || !Array.isArray(accounts) || !accounts.length || accounts.length > 8
    || !call || !address.test(call.from) || !address.test(call.to) || call.data !== "0x313ce567" || call.value !== "0"
    || !word.test(expectedOutput)) throw Error();
  const codes = new Map(), storage = new Map(); let totalBytes = 0, totalSlots = 0;
  for (const account of accounts) {
    if (!address.test(account.address) || codes.has(account.address) || !/^0x(?:[a-f0-9]{2})+$/.test(account.runtimeCode)
      || account.runtimeCode.length > 49_154 || keccak256(account.runtimeCode) !== account.runtimeCodeHash || !Array.isArray(account.storage)) throw Error();
    const code = hexToBytes(account.runtimeCode), slots = new Map(); totalBytes += code.length;
    for (const entry of account.storage) {
      if (!word.test(entry.slot) || !word.test(entry.value) || slots.has(entry.slot)) throw Error();
      slots.set(entry.slot, entry.value); totalSlots++;
    }
    if (totalBytes > 131_072 || totalSlots > 64) throw Error();
    codes.set(account.address, code); storage.set(account.address, slots);
  }
  if (!codes.has(call.to) || codes.has(call.from)) throw Error();
  const failures = new Set(), outputs = []; let gasUsed = 0n;
  const ambient = new Set(["BLOCKHASH", "BLOBHASH", "BLOBBASEFEE", "TIMESTAMP", "NUMBER", "COINBASE", "PREVRANDAO", "DIFFICULTY", "BASEFEE", "GASPRICE", "GASLIMIT", "ORIGIN", "BALANCE", "SELFBALANCE", "TLOAD"]);
  const writes = new Set(["SSTORE", "TSTORE", "SELFDESTRUCT", "CREATE", "CREATE2", "CALLCODE"]);
  for (let pass = 0; pass < 2 && !failures.size; pass++) {
    const common = createCustomCommon({ chainId }, Mainnet, { hardfork: Hardfork.Cancun }), vm = await createVM({ common });
    await vm.stateManager.putAccount(createAddressFromString(call.from), createAccount({ balance: 10n ** BigInt(20 + pass) }));
    for (const [raw, code] of codes) {
      const target = createAddressFromString(raw);
      await vm.stateManager.putAccount(target, createAccount({})); await vm.stateManager.putCode(target, code);
      for (const [slot, value] of storage.get(raw)) await vm.stateManager.putStorage(target, hexToBytes(slot), hexToBytes(value));
    }
    let calls = 0;
    vm.evm.events?.on("beforeMessage", message => {
      const to = message.codeAddress?.toString().toLowerCase() ?? message.to?.toString().toLowerCase();
      if (++calls > 64 || message.depth > 16 || !message.isStatic || message.value !== 0n || !codes.has(to)) failures.add("unobserved-read-call");
    });
    vm.evm.events?.on("step", step => {
      const name = step.opcode.name, raw = step.address.toString().toLowerCase(), code = codes.get((step.codeAddress ?? step.address).toString().toLowerCase());
      if (writes.has(name)) failures.add("state-changing-read");
      if (ambient.has(name)) failures.add("ambient-state-read");
      if (name === "GAS" && !(code?.[step.pc] === 0x5a && [0xf1, 0xf4, 0xfa].includes(code[step.pc + 1]))) failures.add("ambient-gas-read");
      if (name === "SLOAD") {
        const slot = `0x${step.stack.at(-1).toString(16).padStart(64, "0")}`;
        if (!storage.get(raw)?.has(slot)) failures.add("unobserved-storage-slot");
      }
      if (["EXTCODESIZE", "EXTCODECOPY", "EXTCODEHASH"].includes(name)) {
        const target = `0x${(step.stack.at(-1) & ((1n << 160n) - 1n)).toString(16).padStart(40, "0")}`;
        if (!codes.has(target)) failures.add("unobserved-code-read");
      }
    });
    const result = await vm.evm.runCall({ caller: createAddressFromString(call.from), origin: createAddressFromString(call.from),
      to: createAddressFromString(call.to), data: hexToBytes(call.data), value: 0n, isStatic: true, gasLimit: pass ? 1_900_000n : 2_000_000n });
    gasUsed += result.execResult.executionGasUsed;
    if (result.execResult.exceptionError) failures.add("dependency-call-reverted");
    const output = bytesToHex(result.execResult.returnValue); outputs.push(output);
    if (output !== expectedOutput) failures.add("dependency-call-output-mismatch");
  }
  if (!failures.size && outputs[0] !== outputs[1]) failures.add("environment-dependent-read");
  return { status: failures.size ? "needs-context" : "replayed", passes: outputs.length, gasUsed: gasUsed.toString(), failures: [...failures],
    output: failures.size ? null : outputs[0], launchReady: false };
}
