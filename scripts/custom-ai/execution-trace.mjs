// Observes the existing execution only. No additional EVM call, RPC or assertion.
export function createExecutionRecorder({ vm, accounts, deployed, requireTool, plannedSteps, recipients }) {
  const { createAddressFromString, bytesToHex } = requireTool("@ethereumjs/util");
  const { decodeAbiParameters, decodeEventLog } = requireTool("viem");
  const steps = [];
  let executedSteps = 0, size = 0, stopped = false;
  const namedTargets = () => {
    const result = new Map();
    for (const [id, address] of [...Object.entries(accounts).map(([id, address]) => [`account/${id}`, address]), ...[...deployed].map(([id, target]) => [`contract/${id}`, target.address])]) {
      if (![...result.values()].includes(address.toLowerCase())) result.set(id, address.toLowerCase());
    }
    for (const address of recipients()) {
      if (typeof address === "string" && /^0x[a-f0-9]{40}$/i.test(address) && ![...result.values()].includes(address.toLowerCase())) {
        result.set(`recipient/${address.toLowerCase()}`,address.toLowerCase());
      }
    }
    return result;
  };
  const balances = async () => {
    const result = new Map();
    for (const [id, address] of namedTargets()) result.set(id, (await vm.stateManager.getAccount(createAddressFromString(address)))?.balance ?? 0n);
    return result;
  };
  const describe = (inputs, values) => inputs.slice(0, 8).map((input, index) => {
    const raw = typeof values[index] === "bigint" ? values[index].toString()
      : typeof values[index] === "string" && input.type !== "string" ? values[index]
      : JSON.stringify(values[index], (_key, value) => typeof value === "bigint" ? value.toString() : value);
    const value = String(raw ?? "");
    return { name: (input.name || `value${index + 1}`).slice(0, 100), type: input.type.slice(0, 200), value: value.slice(0, 512), truncated: value.length > 512 };
  });
  return {
    async before() {
      if (stopped || steps.length >= 24) return null;
      try { return await balances(); } catch { stopped = true; return null; }
    },
    async record(step, fn, result, before) {
      executedSteps++;
      if (!before) return;
      try {
        const reverted = Boolean(result.execResult.exceptionError);
        const observation = { id: step.id, contract: step.contract, signature: step.signature, from: step.from,
          afterSeconds: step.afterSeconds, value: step.value, read: step.read, status: reverted ? "revert" : "success",
          outputs: [], events: [], nativeChanges: [], detailsComplete: true };
        if (!reverted) {
          if ((fn.outputs?.length ?? 0) > 0) {
            if (result.execResult.returnValue.length > 4096) observation.detailsComplete = false;
            else {
              try {
                observation.outputs = describe(fn.outputs, decodeAbiParameters(fn.outputs, bytesToHex(result.execResult.returnValue)));
                if (fn.outputs.length > 8 || observation.outputs.some(value => value.truncated)) observation.detailsComplete = false;
              } catch { observation.detailsComplete = false; }
            }
          }
          const after = await balances();
          for (const [account, oldBalance] of before) {
            const newBalance = after.get(account) ?? 0n;
            if (oldBalance !== newBalance) observation.nativeChanges.push({ account, before: oldBalance.toString(), after: newBalance.toString() });
          }
          const logs = result.execResult.logs ?? [];
          if (logs.length > 8) observation.detailsComplete = false;
          for (const [address, topics, data] of logs.slice(0, 8)) {
            const target = [...deployed].find(([, entry]) => entry.address.toLowerCase() === bytesToHex(address).toLowerCase());
            if (!target || data.length > 4096) { observation.detailsComplete = false; continue; }
            try {
              const decoded = decodeEventLog({ abi: target[1].artifact.abi, topics: topics.map(bytesToHex), data: bytesToHex(data), strict: true });
              const event = target[1].artifact.abi.find(item => item.type === "event" && item.name === decoded.eventName
                && (() => { try { decodeEventLog({ abi: [item], topics: topics.map(bytesToHex), data: bytesToHex(data), strict: true }); return true; } catch { return false; } })());
              if (!event) { observation.detailsComplete = false; continue; }
              const args = describe(event.inputs, Array.isArray(decoded.args) ? decoded.args : event.inputs.map(input => decoded.args[input.name]));
              if (event.inputs.length > 8 || args.some(value => value.truncated)) observation.detailsComplete = false;
              observation.events.push({ contract: target[0], name: decoded.eventName.slice(0, 100), arguments: args });
            } catch { observation.detailsComplete = false; }
          }
        }
        const bytes = Buffer.byteLength(JSON.stringify(observation));
        if (size + bytes > 60_000) { stopped = true; return; }
        size += bytes; steps.push(observation);
      } catch { stopped = true; }
    },
    result() { return { version: 1, environment: "isolated-declared-fixtures", networkAccess: false, gasFeesCharged: false,
      plannedSteps, executedSteps, detailsComplete: steps.length === executedSteps && steps.every(step => step.detailsComplete), steps }; },
  };
}
