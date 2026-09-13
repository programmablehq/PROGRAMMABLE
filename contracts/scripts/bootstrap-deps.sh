#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LIB_DIR="${CONTRACTS_DIR}/lib"

mkdir -p "${LIB_DIR}"

clone_at() {
  local name="$1"
  local url="$2"
  local commit="$3"
  local target="${LIB_DIR}/${name}"

  if [[ -d "${target}/.git" ]]; then
    local current
    current="$(git -C "${target}" rev-parse HEAD)"
    if [[ "${current}" != "${commit}" ]]; then
      echo "${name}: expected ${commit}, found ${current}" >&2
      exit 1
    fi
    echo "${name}: ${commit} already present"
    return
  fi

  if [[ -e "${target}" ]]; then
    echo "${name}: ${target} exists but is not a Git checkout" >&2
    exit 1
  fi

  git clone --filter=blob:none --no-checkout "${url}" "${target}"
  git -C "${target}" checkout --detach "${commit}"
  echo "${name}: checked out ${commit}"
}

clone_at "liquidity-launcher" "https://github.com/Uniswap/liquidity-launcher.git" \
  "e4660afe4f820f4a39181c7ea1f9bce6c423499f"
clone_at "continuous-clearing-auction" "https://github.com/Uniswap/continuous-clearing-auction.git" \
  "6c9e559e63a7a141a4fe4bd5aa0f47fee1354b58"
clone_at "openzeppelin-uniswap-hooks" "https://github.com/OpenZeppelin/uniswap-hooks.git" \
  "26dc8e53f812a1ca390d470342adb6cd8c3286ad"
clone_at "v4-core" "https://github.com/Uniswap/v4-core.git" \
  "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc"
clone_at "v4-periphery" "https://github.com/Uniswap/v4-periphery.git" \
  "ad04c9f24a170accf5ea1b2836bbafd514537ca6"
clone_at "v4-periphery-v211" "https://github.com/Uniswap/v4-periphery.git" \
  "3231810e39b8c4d569b9d66907fa4ef8cd2cec22"
clone_at "universal-router" "https://github.com/Uniswap/universal-router.git" \
  "999d561c3ad58fb5cab91b602911f3c75591a9c7"
clone_at "openzeppelin-contracts" "https://github.com/OpenZeppelin/openzeppelin-contracts.git" \
  "21c8312b022f495ebe3621d5daeed20552b43ff9"
clone_at "forge-std" "https://github.com/foundry-rs/forge-std.git" \
  "3b20d60d14b343ee4f908cb8079495c07f5e8981"
clone_at "permit2" "https://github.com/Uniswap/permit2.git" \
  "cc56ad0f3439c502c246fc5cfcc3db92bb8b7219"
clone_at "solady" "https://github.com/Vectorized/solady.git" \
  "33b4b98e350bbcba6aa85642957c313e98b5f911"
clone_at "uerc20-factory" "https://github.com/Uniswap/uerc20-factory.git" \
  "6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68"
clone_at "blocknumberish" "https://github.com/Uniswap/blocknumberish.git" \
  "38fe20bc0341d5bc2780d41f90dadb70e10f8cea"
clone_at "solmate" "https://github.com/transmissions11/solmate.git" \
  "4b47a19038b798b4a33d9749d25e570443520647"

echo "All contract dependencies match their pinned commits."
