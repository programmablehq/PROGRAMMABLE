import { seedComposableFeeds } from "./composable-module.mjs";
import { seedEventFeed } from "./event-module.mjs";
// Runs only inside the compiler's permission-restricted child process.
// This gate supports self-contained fee rules. External data adapters must be
// added with their own dependency validation, never accepted by address alone.
export function inspectModule(ast) {
  const diagnostics = new Set();
  const fail = message => diagnostics.add(message);
  const nodes = [];
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (value.nodeType) nodes.push(value);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === "object") walk(child);
    }
  }
  walk(ast);
  const contracts = nodes.filter(n => n.nodeType === "ContractDefinition");
  const contract = contracts[0];
  if (contracts.length !== 1 || contract?.name !== "GeneratedFeeModule" || contract.contractKind !== "contract") {
    fail("Provide only the GeneratedFeeModule contract.");
  }
  if (contract?.baseContracts.length !== 1 || contract.baseContracts[0].baseName.name !== "ICustomAIFeeModuleV1") {
    fail("Inherit only ICustomAIFeeModuleV1.");
  }
  const functions = nodes.filter(n => n.nodeType === "FunctionDefinition");
  const internalFunctions = new Set(functions.filter(n => ["private", "internal"].includes(n.visibility)).map(n => n.id));
  const errors = new Set(nodes.filter(n => n.nodeType === "ErrorDefinition").map(n => n.id));
  const state = nodes.filter(n => n.nodeType === "VariableDeclaration" && n.stateVariable);
  const configuration = state.find(n => n.name === "configurationHash");
  if (!configuration || configuration.mutability !== "immutable" || configuration.visibility !== "public"
    || configuration.typeName?.name !== "bytes32") fail("Declare a public immutable bytes32 configurationHash.");
  for (const variable of state) {
    if (!["constant", "immutable"].includes(variable.mutability)) fail("Fee modules cannot contain mutable storage.");
    if (variable.typeName?.nodeType !== "ElementaryTypeName") fail("Configuration must use fixed elementary values.");
  }
  for (const fn of functions) {
    if (fn.kind === "constructor") {
      if (fn.parameters.parameters.length || fn.stateMutability === "payable") {
        fail("Use a nonpayable constructor without parameters. Embed the agreed configuration in this exact draft.");
      }
    } else if (fn.kind !== "function" || !["view", "pure"].includes(fn.stateMutability)
      || (!["internal", "private"].includes(fn.visibility) && fn.name !== "quoteFee")) {
      fail("Expose only the read-only quoteFee function and immutable configuration getters.");
    }
    if (fn.modifiers?.length) fail("Use explicit conditions inside functions; custom modifiers are not supported by this validator.");
  }
  const builtins = new Set(["require", "assert", "revert", "keccak256", "type"]);
  for (const node of nodes) {
    if (["InlineAssembly", "NewExpression", "FunctionCallOptions", "TryStatement", "ModifierDefinition", "UsingForDirective"].includes(node.nodeType)) {
      fail("Assembly, deployment, delegated execution and custom call machinery are not supported.");
    }
    if (["ForStatement", "WhileStatement", "DoWhileStatement"].includes(node.nodeType)) fail("Use bounded expressions instead of loops in fee quotes.");
    if (node.nodeType === "MemberAccess") {
      if (["msg", "tx"].includes(node.expression?.name)) fail("Fee rules must not depend on transaction sender, origin, value or gas price.");
      if (node.expression?.name === "block" && !["timestamp", "chainid"].includes(node.memberName)) {
        fail("Only block.timestamp and block.chainid are supported block inputs.");
      }
      if (["balance", "code", "codehash"].includes(node.memberName)) fail("External balances and code need a separately verified data adapter.");
    }
    if (node.nodeType === "FunctionCall" && !["typeConversion", "structConstructorCall"].includes(node.kind)) {
      const expression = node.expression;
      // solc serializes builtin declaration IDs as unsigned uint32 sentinels.
      const builtin = expression?.nodeType === "Identifier" && builtins.has(expression.name) && expression.referencedDeclaration >= 2 ** 31;
      const local = expression?.nodeType === "Identifier" && (internalFunctions.has(expression.referencedDeclaration) || errors.has(expression.referencedDeclaration));
      const encoding = expression?.nodeType === "MemberAccess" && expression.expression?.name === "abi"
        && ["encode", "encodePacked"].includes(expression.memberName);
      if (!builtin && !local && !encoding) fail("External or indirect calls need a verified adapter. Keep this module self-contained.");
    }
  }
  // Require the actual hash expression to cover the fixed version and every
  // other immutable, not merely an unrelated mention elsewhere in the source.
  if (configuration) {
    const assignments = nodes.filter(n => n.nodeType === "Assignment" && n.leftHandSide?.referencedDeclaration === configuration.id);
    const expression = configuration.value ?? (assignments.length === 1 ? assignments[0].rightHandSide : undefined);
    const encoded = expression?.expression?.name === "keccak256" && expression.arguments?.[0];
    const args = encoded?.expression?.expression?.name === "abi" && encoded.expression.memberName === "encode" ? encoded.arguments : [];
    const version = args.some(n => n.nodeType === "MemberAccess" && n.expression?.name === "T" && n.memberName === "VERSION_ID");
    const ids = new Set(args.filter(n => n.nodeType === "Identifier").map(n => n.referencedDeclaration));
    if (!version || state.some(n => n.id !== configuration.id && n.mutability === "immutable" && !ids.has(n.id))) {
      fail("Set configurationHash to keccak256(abi.encode(T.VERSION_ID, ...)) including every other immutable value directly.");
    }
  }
  return [...diagnostics];
}

export async function simulateModule(requireTool, contract, ast, expectations = [], feed, composable) {
  const { createVM } = requireTool("@ethereumjs/vm");
  const { createCustomCommon, Mainnet, Hardfork } = requireTool("@ethereumjs/common");
  const { createBlock } = requireTool("@ethereumjs/block");
  const { createAddressFromString, bytesToHex, hexToBytes } = requireTool("@ethereumjs/util");
  const { encodeFunctionData, decodeFunctionResult, toFunctionSelector, keccak256 } = requireTool("viem");
  const diagnostics = [];
  const samples = [];
  const caller = createAddressFromString("0x1000000000000000000000000000000000000001");
  const selector = toFunctionSelector("quoteFee((bytes32,address,uint64,bool,bool,uint256))");
  const startedAt = 1_800_000_000n;
  const offsets = new Set([0n, 1n, 29n, 30n, 31n, 299n, 300n, 3600n, 86399n, 86400n, 86401n, 604800n, 31536000n]);
  // Add boundaries for durations and absolute timestamps appearing in source.
  const units = { seconds: 1n, minutes: 60n, hours: 3600n, days: 86400n, weeks: 604800n };
  function literals(node) {
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "Literal" && node.kind === "number" && /^\d[\d_]*$/.test(node.value)) {
      const value = BigInt(node.value.replaceAll("_", "")) * (units[node.subdenomination] ?? 1n);
      const offset = value > startedAt ? value - startedAt : value;
      if (offset > 0n && offset <= 315360000n) for (const delta of [-1n, 0n, 1n]) offsets.add(offset + delta);
    }
    Object.values(node).forEach(v => Array.isArray(v) ? v.forEach(literals) : v && typeof v === "object" && literals(v));
  }
  literals(ast);
  if (offsets.size > 96) return { diagnostics: ["The fee schedule has too many boundaries for this validator."], cases: 0, samples: [] };
  let cases = 0;
  let expectationCases = 0;
  let maxGas = 0n;
  const deployments = [];
  for (const chainId of [1, 4663]) {
    const common = createCustomCommon({ chainId }, Mainnet, { hardfork: Hardfork.Cancun });
    const vm = await createVM({ common });
    const block = timestamp => createBlock({ header: { number: 1n, timestamp, gasLimit: 30_000_000n } }, { common });
    if (feed) await seedEventFeed(requireTool, vm, feed, startedAt);
    if (composable) await seedComposableFeeds(requireTool, vm, composable, startedAt);
    const deployed = await vm.evm.runCall({ caller, data: hexToBytes(`0x${contract.evm.bytecode.object}`), gasLimit: 5_000_000n, block: block(startedAt - 172800n) });
    if (deployed.execResult.exceptionError || !deployed.createdAddress) return { diagnostics: [`The module constructor failed on chain ${chainId}.`], cases, samples: [] };
    const to = deployed.createdAddress;
    const call = async (functionName, args, timestamp) => {
      // Each quote starts with cold access state, as a separate transaction.
      vm.evm.journal.cleanup();
      const result = await vm.evm.runCall({ caller, to, data: hexToBytes(encodeFunctionData({ abi: contract.abi, functionName, args })),
        gasLimit: 100_000n, isStatic: true, block: block(timestamp) });
      maxGas = result.execResult.executionGasUsed > maxGas ? result.execResult.executionGasUsed : maxGas;
      if (result.execResult.exceptionError) throw new Error("reverted or exceeded 100,000 gas");
      return bytesToHex(result.execResult.returnValue);
    };
    let configurationHash;
    try {
      configurationHash = decodeFunctionResult({ abi: contract.abi, functionName: "configurationHash", data: await call("configurationHash", [], startedAt) });
      if (!/^0x[0-9a-f]{64}$/i.test(configurationHash) || /^0x0+$/.test(configurationHash)) throw Error();
    } catch { return { diagnostics: ["configurationHash must return a nonzero bytes32."], cases, samples: [] }; }
    deployments.push({ chainId, timestamp: Number(startedAt), runtimeHash: keccak256(await vm.stateManager.getCode(to)), configurationHash });
    // These expected values come from a separate interpretation of the user's
    // request, before the generator sees or emits source. A safe but incorrect
    // fee schedule must not become a launchable artifact.
    for (const expected of expectations) for (const exactInput of [true, false]) {
      const timestamp = startedAt + BigInt(expected.afterSeconds);
      try {
        if (feed) await seedEventFeed(requireTool, vm, feed, timestamp, expected.feedValue, expected.feedFresh);
        if (composable) await seedComposableFeeds(requireTool, vm, composable, timestamp, expected.feeds);
        const data = await call("quoteFee", [{ poolId: `0x${"00".repeat(32)}`, router: caller.toString(),
          buy: expected.buy, exactInput, launchTimestamp: startedAt, specifiedAmount: 10n ** 18n }], timestamp);
        const [magic, bps, until, hash] = decodeFunctionResult({ abi: contract.abi, functionName: "quoteFee", data });
        if (magic !== selector || until < timestamp || hash !== configurationHash) throw Error("invalid fee quote");
        if (Number(bps) + 50 !== expected.totalFeeBps) throw Error(`expected ${expected.totalFeeBps} total bps, received ${Number(bps) + 50}`);
        expectationCases++;
      } catch (error) {
        return { diagnostics: [`Requested rule mismatch on chain ${chainId}, ${expected.buy ? "buy" : "sell"}, t+${expected.afterSeconds}s: ${error.message}.`],
          cases, samples: [], expectationCases, maxGas: maxGas.toString() };
      }
    }
    for (const offset of [...offsets].sort((a, b) => a < b ? -1 : 1)) {
      for (const buy of [true, false]) for (const exactInput of [true, false]) {
        // Full direction/mode coverage at each boundary; zero, dust, normal,
        // maximum core amount and alternate pool/router context each tested.
        for (const [index, amount] of [0n, 1n, 10n ** 18n, (1n << 127n) - 1n].entries()) {
          const timestamp = startedAt + offset;
          try {
            if (feed) await seedEventFeed(requireTool, vm, feed, timestamp);
            if (composable) await seedComposableFeeds(requireTool, vm, composable, timestamp);
            const data = await call("quoteFee", [{ poolId: `0x${(index % 2 ? "ab" : "00").repeat(32)}`,
              router: index % 2 ? "0x2000000000000000000000000000000000000002" : caller.toString(), buy, exactInput, launchTimestamp: startedAt, specifiedAmount: amount }], timestamp);
            if (data.length !== 258) throw new Error("returned an invalid response length");
            const [magic, bps, until, hash] = decodeFunctionResult({ abi: contract.abi, functionName: "quoteFee", data });
            if (magic !== selector) throw new Error("returned the wrong quote selector");
            if (bps > 1450) throw new Error("exceeded the 15% total fee cap");
            if (until < timestamp) throw new Error("returned an expired quote");
            if (hash !== configurationHash) throw new Error("changed the bound configuration hash");
            cases++;
            if (index === 2 && exactInput && chainId === 1) samples.push({ afterSeconds: Number(offset), buy, totalFeeBps: Number(bps) + 50 });
          } catch (error) {
            diagnostics.push(`Chain ${chainId}, ${buy ? "buy" : "sell"}, ${exactInput ? "exact input" : "exact output"}, t+${offset}s: ${error.message}.`);
            return { diagnostics, cases, samples: [], maxGas: maxGas.toString() };
          }
        }
      }
    }
  }
  return { diagnostics, cases, samples, maxGas: maxGas.toString(), deployments, expectationCases };
}
