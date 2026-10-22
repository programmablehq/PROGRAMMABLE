import { lstatSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const credentialFile = process.env.CUSTOM_AI_CREDENTIAL_FILE;
if (!credentialFile || !process.env.CUSTOM_AI_COMPILER_DIR) {
  throw new Error("Set CUSTOM_AI_CREDENTIAL_FILE and CUSTOM_AI_COMPILER_DIR for the local preview.");
}
const key = readFileSync(credentialFile, "utf8").trim().match(/^ANTHROPIC_API_KEY=(sk-ant-[A-Za-z0-9_-]+)$/)?.[1];
if (!key) throw new Error("The Claude credential file is invalid.");
// Only the existing read-provider bindings reach the local web server. The
// isolated compiler/VM still receives no provider or Claude credentials.
const rpcNames = new Set([
  "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER", "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL",
  "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT", "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_PROVIDER",
  "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL", "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT",
  "ROBINHOOD_V4_RPC_PRIMARY_URL", "ROBINHOOD_V4_RPC_SECONDARY_URL",
]);
let rpcEnvironment = {};
if (process.env.CUSTOM_AI_RPC_CONFIG_FILE) {
  try {
    const file = process.env.CUSTOM_AI_RPC_CONFIG_FILE, stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size > 16_384) throw new Error();
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([name, entry]) =>
      !rpcNames.has(name) || typeof entry !== "string" || !entry || /[\r\n]/.test(entry))) throw new Error();
    rpcEnvironment = value;
  } catch { throw new Error("The local RPC configuration must be a private JSON file containing only read-provider bindings."); }
}
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3093"], {
  cwd: root, stdio: "inherit", env: {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NODE_ENV: "development", CUSTOM_AI_LOCAL_PREVIEW: "true", ANTHROPIC_API_KEY: key,
    CUSTOM_AI_COMPILER_DIR: process.env.CUSTOM_AI_COMPILER_DIR,
    ...rpcEnvironment,
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 1));
