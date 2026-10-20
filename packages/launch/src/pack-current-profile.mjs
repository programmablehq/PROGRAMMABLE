import { getLaunchCapabilities } from "./api-client.mjs";
import { PACK_CONFIG_SCHEMA_V3 } from "./constants.mjs";
import { readStrictJsonFile } from "./io.mjs";
import { packLaunch } from "./pack.mjs";

/** Only a fresh CLI pack without an explicit version selects current capabilities.
 * Exact validation/reproduction and stored requests keep their original version. */
export async function packFreshLaunch(options) {
  const { value: config } = await readStrictJsonFile(options.configPath);
  let directNativeProfileVersion, directNativeTradeFeePolicy;
  if (config.schemaVersion === PACK_CONFIG_SCHEMA_V3 && !Object.hasOwn(config, "profileVersion")) {
    const capabilities = await getLaunchCapabilities({
      apiVersion: 3,
      ...(config.chainId === "8453" ? { chainId: "8453" } : {}),
      fetchImpl: options.fetchImpl,
      maxAttempts: options.maxAttempts,
      timeoutMs: options.timeoutMs,
    });
    directNativeProfileVersion = capabilities.resource.profile.profileVersion;
    directNativeTradeFeePolicy = config.chainId === "8453"
      ? capabilities.resource.profile.programmableTradeFeePolicy
      : capabilities.resource.programmableTradeFeePolicy?.policy;
  }
  return (options.packLaunchImpl ?? packLaunch)({
    configPath: options.configPath,
    outputPath: options.outputPath,
    receiptPath: options.receiptPath,
    ...(directNativeProfileVersion === undefined ? {} : { directNativeProfileVersion }),
    ...(directNativeTradeFeePolicy === undefined ? {} : { directNativeTradeFeePolicy }),
  });
}
