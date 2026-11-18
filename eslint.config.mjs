import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".vercel/**",
    ".codex-temp-programmable-readme-gif/**",
    "node_modules/**",
    // Published MIT distribution files, kept byte-for-byte for wallet storage compatibility.
    "packages/walletconnect-storage-runtime/upstream/**",
    "work/**",
    "contracts/lib/**",
    "contracts/out/**",
    "contracts/cache/**",
    "contracts/broadcast/**",
    "indexer/.envio/**",
    "indexer/envio-env.d.ts",
    "ops/**/.cre_build_tmp.*",
    "ops/**/binary.wasm",
    // Independent Vite app; checked by its own build and test scripts.
    "ops/hazarrobin/**",
  ]),
]);
