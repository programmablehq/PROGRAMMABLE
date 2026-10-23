import "server-only";
import { encodeDeployData, getAddress, parseUnits, zeroAddress, type Abi, type Address, type Hex } from "viem";
import code from "./program-code.json";
import { bindProgramSource, parseProgram } from "./program";
import { CustomAIError, type Draft } from "./types";

export const programArtifact = code.artifact as typeof code.artifact & { abi: Abi; initCode: Hex; runtimeTemplate: Hex };

export function checkProgram(draft: Draft) {
  if (!draft.program) return;
  const { spec, chainId, quote, bundleHash } = draft.program;
  parseProgram(spec);
  if (bundleHash !== code.bundleHash || bindProgramSource(draft.source, { spec, chainId, quote }, bundleHash) !== draft.source) {
    throw new CustomAIError("program", "Recheck this program in the chat before launching it.", 422);
  }
}

export function programInitCode(draft: Draft, binding: { factory: Address; account: Address; launchSalt: Hex; quote: Address; quoteDecimals: number }): Hex {
  checkProgram(draft);
  if (!draft.program || draft.program.quote.toLowerCase() !== binding.quote.toLowerCase()) throw new CustomAIError("program", "Recheck the program after changing its pair token.", 422);
  const spec = draft.program.spec;
  if ((spec.maximumBatch.split(".")[1]?.length ?? 0) > binding.quoteDecimals) throw new CustomAIError("program", "The maximum buyback uses more decimals than the pair token supports.", 422);
  const maximumBatch = parseUnits(spec.maximumBatch, binding.quoteDecimals);
  if (maximumBatch > (1n << 127n) - 1n) throw new CustomAIError("program", "The maximum buyback exceeds the supported amount.", 422);
  return encodeDeployData({ abi: programArtifact.abi, bytecode: programArtifact.initCode, args: [{
    factory: binding.factory, creator: binding.account, launchSalt: binding.launchSalt, quote: binding.quote,
    quoteDecimals: binding.quoteDecimals, mode: ["distribution", "staking", "buyback"].indexOf(spec.kind),
    recipient: spec.kind === "staking" ? zeroAddress : spec.recipient === "creator" ? binding.account : getAddress(spec.recipient),
    interval: BigInt(spec.intervalSeconds), maximumBatch, minimumTokensPerQuote: parseUnits(spec.minimumTokensPerQuote, 18),
  }] });
}
