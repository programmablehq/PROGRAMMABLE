#!/usr/bin/env bash
set -euo pipefail

FOUNDATION_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOUNDATION_CONTRACTS_DIR="$(cd "${FOUNDATION_SCRIPT_DIR}/../.." && pwd)"
cd "${FOUNDATION_CONTRACTS_DIR}"

verify_pin() {
  local dependency="$1"
  local expected="$2"
  local observed
  observed="$(git -C "lib/${dependency}" rev-parse HEAD)"
  if [[ "${observed}" != "${expected}" ]]; then
    printf '%s: dependency pin mismatch\n' "${dependency}" >&2
    exit 1
  fi
  if ! git -C "lib/${dependency}" diff --quiet HEAD --; then
    printf '%s: tracked dependency files differ from the pin\n' "${dependency}" >&2
    exit 1
  fi
}

verify_pin v4-core 59d3ecf53afa9264a16bba0e38f4c5d2231f80bc
verify_pin v4-periphery ad04c9f24a170accf5ea1b2836bbafd514537ca6
verify_pin v4-periphery-v211 3231810e39b8c4d569b9d66907fa4ef8cd2cec22
verify_pin universal-router 999d561c3ad58fb5cab91b602911f3c75591a9c7
verify_pin openzeppelin-contracts 21c8312b022f495ebe3621d5daeed20552b43ff9
verify_pin openzeppelin-uniswap-hooks 26dc8e53f812a1ca390d470342adb6cd8c3286ad
verify_pin permit2 cc56ad0f3439c502c246fc5cfcc3db92bb8b7219
verify_pin forge-std 3b20d60d14b343ee4f908cb8079495c07f5e8981

export FOUNDRY_PROFILE=module-foundation
# Keep the compiler and test budgets in the committed profile. Ambient overrides
# must not silently change its source roots, artifacts, bytecode or invariant work.
unset FOUNDRY_SRC FOUNDRY_TEST FOUNDRY_SCRIPT FOUNDRY_OUT FOUNDRY_CACHE_PATH
unset FOUNDRY_VIA_IR FOUNDRY_OPTIMIZER FOUNDRY_OPTIMIZER_RUNS FOUNDRY_AUTO_DETECT_REMAPPINGS
unset FOUNDRY_FUZZ_RUNS FOUNDRY_INVARIANT_RUNS FOUNDRY_INVARIANT_DEPTH FOUNDRY_INVARIANT_FAIL_ON_REVERT
export FOUNDATION_RPC_URL="${FOUNDATION_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
# The public RPC does not retain historic metadata for every previously unused CREATE2 address.
# Fix a fresh block for this entire run, or supply an archive-capable endpoint and explicit retained block.
if [[ -z "${FOUNDATION_FORK_BLOCK:-}" ]]; then
  FOUNDATION_FORK_BLOCK="$(cast block-number --rpc-url "${FOUNDATION_RPC_URL}")"
fi
export FOUNDATION_FORK_BLOCK
if [[ ! "${FOUNDATION_FORK_BLOCK}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Foundation requires an explicit positive fork block.\n' >&2
  exit 1
fi
printf 'Foundation fork block: %s\n' "${FOUNDATION_FORK_BLOCK}"
forge fmt --check src/module-foundation test/module-foundation
forge lint src/module-foundation
forge build src/module-foundation/FoundationFactoryV1.sol --sizes
forge test --match-path 'test/module-foundation/*.t.sol' -vv
