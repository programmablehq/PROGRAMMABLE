import { build } from "esbuild";
await build({entryPoints:["ops/custom-ai-worker/cli.ts"],outfile:"out/custom-ai-worker.mjs",bundle:true,
  platform:"node",format:"esm",target:"node24",conditions:["react-server"],external:["pg"],
  banner:{js:'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'},
  tsconfig:"tsconfig.json",logLevel:"warning"});
