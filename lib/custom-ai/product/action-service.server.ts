import "server-only";
import {getAddress} from "viem";
import {requireFreshCustomAIAuthority, type AIAuthority} from "../auth.server";
import type {createProductionDependencyRpcs} from "../dependency-rpc.server";
import type {AIStore} from "../store.server";
import {CustomAIError} from "../types";
import {automaticProductRead, productActionFunction} from "./action-automatic";
import {prepareProductActionInput} from "./action-prepare.server";
import {readProductAction} from "./action-read.server";
import {readProductRuntimeSource} from "./runtime-source.server";
import type {ProductRuntime} from "./runtime";

type Result = Awaited<ReturnType<typeof readProductAction>>;

/** Requested reads share contract observations and coalesce identical calls.
 * Neither the browser nor a model chooses a target, provider, selector or block. */
export function createProductValueReader(deps: {
  store: () => AIStore;
  runtime: (request: Request, authority: AIAuthority, id: string) => Promise<ProductRuntime>;
  rpcs: typeof createProductionDependencyRpcs;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  type Cell = {until: number; pending?: Promise<Result>; value?: Result; error?: CustomAIError};
  const cache = new Map<string, Cell>();
  return async (request: Request, authority: AIAuthority, id: string, actionId: string): Promise<{value: Result; runtime: ProductRuntime}> => {
    const current = requireFreshCustomAIAuthority(request, authority);
    if (request.method !== "GET" || !/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(id)
      || !/^[a-z][a-z0-9-]{0,63}$/.test(actionId)) throw new CustomAIError("product-value-input", "Choose a value from your saved product.", 400);
    const source = await readProductRuntimeSource(deps.store(), current.owner, id);
    const hasWallet = () => current.principal.wallets.some(wallet => getAddress(wallet) === getAddress(source.controller));
    if (!hasWallet()) throw new CustomAIError("wallet", "Reconnect the wallet that launched this product.", 403);
    const action = source.implementation.actions.find(item => item.id === actionId);
    const component = action && source.implementation.components.find(item => item.id === action.target);
    const contract = component && source.contracts.find(item => item.source === component.source && item.contract === component.contract);
    const fn = action && contract && productActionFunction(contract.abi, action.signature);
    const mode = fn && automaticProductRead(fn);
    if (!action || !mode || !fn || action.mutability !== fn.stateMutability)
      throw new CustomAIError("product-value-action", "This value needs additional inputs or a separate wallet step.", 409);
    const args = mode === "wallet" ? [source.controller] : [];
    const input = prepareProductActionInput(source, actionId, source.controller, args);
    const runtime = await deps.runtime(request, authority, id);
    const key = JSON.stringify([current.owner, source.id, input.id, runtime.block.hash, runtime.checkedAt]);
    let cell = cache.get(key);
    if (cell && !cell.pending && cell.until <= now()) {cache.delete(key); cell = undefined;}
    if (!cell) {
      while (cache.size >= 128) {
        const oldest = [...cache].find(([, item]) => !item.pending);
        if (!oldest) throw new CustomAIError("product-value-busy", "Contract reads are busy. Try again shortly.", 429, 2000);
        cache.delete(oldest[0]);
      }
      const entry: Cell = {until: 0}; cache.set(key, entry); cell = entry;
      entry.pending = (async () => {
        const rpcs = deps.rpcs({productActionRead: {chainId: source.chainId, from: input.caller, to: input.target,
          data: input.data, blockNumber: runtime.block.number, blockHash: runtime.block.hash}})(source.chainId);
        const result = await readProductAction(source, runtime, {id: actionId, caller: source.controller, arguments: args}, rpcs,
          {signal: request.signal, now});
        entry.value = result; entry.until = now() + 10_000; return result;
      })().catch(error => {
        entry.error = error instanceof CustomAIError ? error : new CustomAIError("product-value-unconfirmed", "This contract value could not be confirmed. Try again shortly.", 503);
        entry.until = now() + 3000; throw entry.error;
      }).finally(() => {delete entry.pending;});
    }
    if (cell.error) throw cell.error;
    const value = cell.pending ? await cell.pending : cell.value!;
    requireFreshCustomAIAuthority(request, authority);
    if (!hasWallet()) throw new CustomAIError("wallet", "Reconnect the wallet that launched this product.", 403);
    return {value: structuredClone(value), runtime: structuredClone(runtime)};
  };
}
