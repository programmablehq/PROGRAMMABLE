import "server-only";
import { createHash } from "node:crypto";
import { getAddress, zeroAddress, type Address } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { MAX_TOKEN_IMAGE_UPLOAD_BYTES, PROGRAMMABLE_TOKEN_IMAGE_HOST } from "@/lib/token-image";
import { HOOK_PERMISSION_BITS, LAUNCH_SEEDED_CONCENTRATED_LIQUIDITY_VECTORS, HOOK_INVENTORY_CUSTOM_ACCOUNTING_VECTORS } from "@/packages/launch/src/constants.mjs";
import { createGeneralPublicSource, checkedGeneralPublicSource, generalSourcePublicUri, type GeneralPublicSource, type OwnedGeneralLaunchSource } from "./public-launch-source.server";
import { resolveGeneralDeploymentValues } from "./deployment-values.server";
import { coinPresentationIssue } from "./coin-setup";
import { CustomAIError } from "./types";

export type GeneralPackIdentity = { nonce: `0x${string}`; sourceLineageNonce: string; validAfter: string; deadline: string; checkedAt: string };
export type GeneralPackInput = { source: OwnedGeneralLaunchSource; exported: GeneralPublicSource; url: string;
  controller: Address; nativeFundingWei?: string; imageBytes: Uint8Array; identity: GeneralPackIdentity };
const invalid = (message = "This saved source needs a complete production deployment before it can be prepared."): never => {
  throw new CustomAIError("launch-pack", message, 422);
};

/** Build only bounded local files from an owned source and a separately stored
 * public export. No inference, source regeneration, live reads or submission. */
export function generalGraphPackConfig(input: GeneralPackInput) {
  const source = input.source, { project, compilation } = source;
  if (source.bindingHash !== canonicalBrowserSha256V2("programmable.custom-ai-launch-source.v1", source.binding)
    || source.binding.projectHash !== project.hash || source.binding.artifactHash !== compilation.artifactHash
    || source.binding.scenarioHash !== source.scenarios.hash || source.binding.blueprintId !== source.blueprint.id) return invalid();
  const production = project.production, recipe = project.deployment, settings = source.binding.settings;
  if (!production || production.route !== "graph-v3" || !production.graphProfile || project.chainId === 4663)
    return invalid("This network uses its own Launch Plan preparation. Keep the saved source on its selected network.");
  const controller = getAddress(input.controller);
  if (controller.toLowerCase() !== source.binding.account.toLowerCase()) return invalid();
  const values = resolveGeneralDeploymentValues(project, compilation, { controller, settings,
    ...(input.nativeFundingWei === undefined ? {} : { nativeFundingWei: input.nativeFundingWei }) });
  if (!recipe?.fees || !recipe.liquidityModel) return invalid("Save the source's fee selection and liquidity design before preparing it.");
  // EIP-3009 and ERC20 funding need their own explicit signed authorization.
  // Never turn a quote-token amount into ETH/HYPE or select another currency.
  if (values.quoteCurrency !== zeroAddress) return invalid("This design needs its explicit token-funding authorization before launch preparation.");
  if ((production.graphProfile.fundingPolicy as { launchFundingRequired?: boolean })?.launchFundingRequired === true
    && BigInt(values.nativeValueWei) === 0n) return invalid("This launch profile needs the declared native funding amount. Keep the amount in the coin details and deployment consistent.");
  const exported = checkedGeneralPublicSource(input.exported, createGeneralPublicSource(source).id);
  if (input.url !== generalSourcePublicUri(exported.id)) return invalid();
  for (const field of ["description", "website", "x"] as const) {
    const issue = coinPresentationIssue(settings, field); if (issue) return invalid(issue);
  }
  const image = source.binding.image;
  if (!image || !/^[a-f0-9]{64}$/u.test(image.id) || !/^[a-f0-9]{64}$/u.test(image.hash)
    || image.url !== `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/custom-ai-${image.id}.webp`
    || input.imageBytes.byteLength < 1 || input.imageBytes.byteLength > MAX_TOKEN_IMAGE_UPLOAD_BYTES
    || createHash("sha256").update(input.imageBytes).digest("hex") !== image.hash) return invalid("Choose the saved coin image before preparing it.");
  const identity = structuredClone(input.identity);
  if (!/^0x(?!0{64}$)[a-f0-9]{64}$/u.test(identity.nonce) || !/^(?:0|[1-9][0-9]{0,77})$/u.test(identity.sourceLineageNonce)
    || BigInt(identity.sourceLineageNonce) >= 2n ** 256n || !/^\d{1,16}$/u.test(identity.validAfter) || !/^\d{1,16}$/u.test(identity.deadline)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(identity.checkedAt)
    || !Number.isFinite(Date.parse(identity.checkedAt)) || new Date(identity.checkedAt).toISOString() !== identity.checkedAt) return invalid();
  const files: { path: string; bytes: Uint8Array }[] = [];
  const json = (path: string, value: unknown) => { files.push({ path, bytes: Buffer.from(`${canonicalBrowserJsonV2(value)}\n`) }); };
  json("input.json", exported.content.compilerInput);
  for (const artifact of exported.content.artifacts) json(artifact.path, artifact.artifact);
  for (const [id, evidence] of Object.entries(exported.content.evidence)) json(`evidence/${id}.json`, evidence);
  files.push({ path: "image.webp", bytes: Uint8Array.from(input.imageBytes) });
  const targets = values.targets.map((target, index) => {
    const artifact = exported.content.artifacts.find(artifact => artifact.source === target.source && artifact.contract === target.contract && artifact.role === target.role);
    const compiled = compilation.contracts.find(artifact => artifact.source === target.source && artifact.contract === target.contract && artifact.role === target.role);
    if (!artifact || !compiled) return invalid();
    return { targetId: target.id, compilationUnitId: "project", artifact: artifact.path,
      applicantSalt: target.role === "hook" ? { mode: "deterministic-hook-permission-grind-v1", start: "0", maxAttempts: "262144" }
        : `0x${(index + 1).toString(16).padStart(64, "0")}`,
      constructorArguments: target.constructorArguments, initializer: target.initializer,
      deploymentValueWei: target.deploymentValueWei, initializerValueWei: target.initializerValueWei,
      componentKind: target.role === "token" || target.role === "hook" ? target.role : "other",
      declaredHookPermissions: target.role === "hook" ? Object.entries(HOOK_PERMISSION_BITS).filter(([,bit]) => Number(target.hookPermissions) & 1 << bit).map(([name]) => name) : null,
      // These internal preview slots confer no authority and are never emitted
      // as a request. The canonical materializer must replace every slot from
      // exact constructor execution before the final graph is returned.
      runtimeImmutables: Object.keys(compiled.immutableReferences).map(immutableId => ({ immutableId, abiType: "bytes32", literal: `0x${"00".repeat(32)}` })),
    };
  });
  const model = recipe.liquidityModel;
  const liquidityModel = { schemaVersion: "programmable.direct-native-liquidity-model-intent.v1", model,
    declaredLaunchState: model === "external-concentrated-liquidity" ? "liquidity_required" : "assessment_required",
    ...(model === "external-concentrated-liquidity" ? {} : {
      ...(model === "launch-seeded-concentrated-liquidity" ? { liquidityTargetId: recipe.pool.initializer } : { inventoryTargetId: recipe.pool.hook }),
      assessment: { schemaVersion: "programmable.direct-native-liquidity-model-assessment.v1", status: "required", requestClaimsExecution: false,
        requiredVectorIds: [...(model === "launch-seeded-concentrated-liquidity" ? LAUNCH_SEEDED_CONCENTRATED_LIQUIDITY_VECTORS : HOOK_INVENTORY_CUSTOM_ACCOUNTING_VECTORS)] },
    }) };
  const config = { schemaVersion: "programmable.launch-pack-config.v3", profileVersion: production.profileVersion,
    launchWallet: controller, chainId: String(project.chainId), nonce: identity.nonce,
    source: { root: ".", paths: ["input.json"], sourceLineageNonce: identity.sourceLineageNonce,
      publicOrigin: { url: input.url, revision: exported.id.slice(7) } },
    compilationUnits: [{ compilationUnitId: "project", standardJson: "input.json" }], targets,
    pool: { tokenTargetId: recipe.pool.token, hookTargetId: recipe.pool.hook, fee: recipe.pool.fee,
      tickSpacing: recipe.pool.tickSpacing, quoteCurrency: values.quoteCurrency },
    projectMetadata: { schemaVersion: "programmable.project-metadata-input.v1", token: { name: settings.name, symbol: settings.symbol },
      presentation: { description: settings.description!.normalize("NFC").replace(/\r\n?/gu, "\n").trim(), image: { sourcePath: "image.webp", uri: image.url },
        links: [{ kind: "website", uri: new URL(settings.website!.trim()).href }, { kind: "x", uri: new URL(settings.x!.trim()).href }] } },
    launchProfile: { schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3",
      profileId: "programmable.direct-native-hook-graph.v1", profileRevision: 3,
      targetRoles: { tokenTargetId: recipe.pool.token, hookTargetId: recipe.pool.hook, initializerTargetId: recipe.pool.initializer, platformFeeBindingTargetId: recipe.pool.platformFeeBinding },
      liquidityModel, fundingMode: BigInt(values.nativeValueWei) === 0n ? "none" : "wallet-transaction-value",
      accountingMode: "inclusive-selected-total", assessmentBase: "executed-gross-declared-quote", feeCurrency: "declared-quote-currency",
      claimMode: "claim-authority-selected-recipient", applicantSelectedBuyHundredthsOfBip: String(recipe.fees.buyPpm), applicantSelectedSellHundredthsOfBip: String(recipe.fees.sellPpm) },
    permitWindow: { validAfter: identity.validAfter, deadline: identity.deadline },
    agentAttestation: { agentId: "programmable-custom-ai", checkedAt: identity.checkedAt,
      checks: Object.keys(exported.content.evidence).map(checkId => ({ checkId, evidence: `evidence/${checkId}.json` })) } };
  if (files.reduce((size, file) => size + file.bytes.byteLength, 0) > 6_000_000) return invalid();
  return { config, files, identity, values, source: structuredClone(source), publicSourceId: exported.id,
    bindingHash: source.bindingHash, productionId: production.id, configHash: canonicalBrowserSha256V2("programmable.custom-ai-initial-pack-config.v1", config), launchReady: false as const };
}
