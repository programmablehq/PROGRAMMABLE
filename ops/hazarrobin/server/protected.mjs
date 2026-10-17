import { getContractAddress, keccak256 } from 'viem';
import { LAUNCH_PROTECTION_RECIPES_V1, readEthereumNative30RuntimeWordsV1 as wordsOf } from '../vendor/native-proofs.mjs';
import { same, need } from './rpc.mjs';

const ZERO = '0x0000000000000000000000000000000000000000';
const addressOf = (words, name) => {
  const word = words?.[name];
  need(word && /^0x[0-9a-f]{64}$/i.test(word) && BigInt(word) < 1n << 160n, 'Ungültige unveränderliche Gebührenadresse.');
  return `0x${word.slice(-40)}`;
};

/** Match both published protection versions before reading either fee vault. */
export function protectedCandidate(market, runtime) {
  const match = Object.entries(LAUNCH_PROTECTION_RECIPES_V1).map(([id, recipe]) => ({ id, recipe, words: wordsOf(recipe.hook, runtime) })).find(x => x.words);
  if (!match) return null;
  const w = match.words;
  need(BigInt(w.CHAIN_ID) === BigInt(market.chainId) && same(addressOf(w, 'poolManager'), market.poolManager) &&
    same(addressOf(w, 'CANONICAL_POOL_MANAGER'), market.poolManager) && same(addressOf(w, 'token'), market.currency1) &&
    same(market.currency0, ZERO) && BigInt(w.lpFee) === BigInt(market.fee) && BigInt(w.tickSpacing) === BigInt(market.tickSpacing) &&
    (BigInt(market.hooks) & 0x3fffn) === 0x20ccn, 'Geschützter Launch gehört nicht zu diesem Pool.');
  const vault = addressOf(w, 'feeVault'), module = addressOf(w, 'module'), opening = addressOf(w, 'openingTaxVault');
  need(same(vault, getContractAddress({ from: market.hooks, nonce: 1n })) &&
    same(module, getContractAddress({ from: market.hooks, nonce: 2n })) &&
    same(opening, getContractAddress({ from: market.hooks, nonce: 3n })), 'Gebührenkonten gehören nicht zum geschützten Launch.');
  return { ...match, market, vault, module, opening };
}

export function proveProtectedVaults(candidate, codes) {
  const { recipe, market, words, vault, module, opening } = candidate;
  const code = a => Object.entries(codes).find(([key]) => same(key, a))?.[1];
  const moduleCode = code(module), moduleWords = moduleCode && wordsOf(recipe.module, moduleCode);
  need(moduleWords && same(keccak256(moduleCode), words.moduleCodeHash) &&
    same(addressOf(moduleWords, 'kernel'), market.hooks) && same(addressOf(moduleWords, 'token'), market.currency1),
  'Schutzmodul stimmt nicht mit dem Gebührenvertrag überein.');
  return [vault, opening].map((address, index) => {
    const runtime = code(address), w = runtime && wordsOf(recipe.vault, runtime);
    need(w && same(addressOf(w, 'poolManager'), market.poolManager) && same(addressOf(w, 'kernel'), market.hooks) &&
      same(addressOf(w, 'creatorRecipient'), index ? recipe.recipient : addressOf(moduleWords, 'developer')),
    'Geschütztes Gebührenkonto stimmt nicht mit seiner Quelle überein.');
    return { address, recipient: recipe.recipient, creator: addressOf(w, 'creatorRecipient'), runtimeCodeHash: keccak256(runtime), opening: index === 1 };
  });
}
