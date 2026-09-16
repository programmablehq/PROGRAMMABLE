import { NextResponse } from "next/server";
import { getAddress, type Hex } from "viem";
import { compileOpenConfig, type OpenConfigContext } from "@/packages/classic-modules/src/open-config.mjs";
import { parseFoundationAvailability } from "@/lib/module-foundation/availability";
import { readFoundationAvailabilityResponse } from "@/lib/server/module-foundation/availability";
import { bindFoundationCatalogV1, resolveFoundationCatalogEntryV1 } from "@/lib/module-foundation/catalog";
import { composeFoundationUiSelectionsV1, decodeFoundationFieldsV1, foundationAssetForAddressV1,
  FOUNDATION_CREATOR_SHARE_FIELD_V1 } from "@/lib/module-foundation/presentation";
import { FOUNDATION_HOST_ADAPTER_ID_V1, foundationRequire } from "@/lib/module-foundation/manifest";
import { foundationAssetAddressesForFieldsV1, resolveFoundationAssetsV1 } from "@/lib/module-foundation/assets";
import { assertFoundationInfrastructure, createFoundationClient, foundationMetadata, readFoundationQuote } from "@/lib/module-foundation/client";
import { FOUNDATION_CHAIN_ID, FOUNDATION_INFRASTRUCTURE } from "@/lib/module-foundation/constants";
import { foundationFactoryAbiFor } from "@/lib/module-foundation/protocol";
import { nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleHash, moduleRecord } from "@/lib/module-mode/release";
import type { FoundationLaunchDraft } from "@/lib/module-foundation/ui-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Read-only composition from admitted source. Request JSON cannot supply review or runtime authority. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) throw new Error("Send the launch details as JSON.");
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 262_144) throw new Error("The module configuration is too large."); chunks.push(value); }
    } finally { await reader.cancel().catch(() => undefined); }
    const body = moduleRecord(nativeJson(JSON.parse(Buffer.concat(chunks).toString("utf8"))),
      ["account", "releaseDigest", "tokenSalt", "draft"], "foundation.compose") as unknown as {
      account: string; releaseDigest: Hex; tokenSalt: Hex; draft: FoundationLaunchDraft };
    const draft = moduleRecord(body.draft, ["name", "symbol", "description", "image", "socialLinks", "quoteAsset", "creatorFeeBps",
      "initialBuy", "startValuationQuote", "additionalLiquidity", "modules"], "foundation.compose.draft") as unknown as FoundationLaunchDraft;
    const account = getAddress(body.account);
    if (!/^0x[0-9a-fA-F]{64}$/.test(body.tokenSalt)) throw new Error("The launch salt is invalid.");
    const availability = parseFoundationAvailability(await readFoundationAvailabilityResponse());
    const binding = availability.binding;
    if (!availability.available || !binding || binding.releaseDigest !== body.releaseDigest) throw new Error("The reviewed launch version is unavailable. Review again.");
    const catalog = bindFoundationCatalogV1(availability.catalog.document, availability.catalog.authority);
    foundationRequire(Array.isArray(draft.modules) && draft.modules.length <= 8,
      "FOUNDATION_MODULE_LIMIT", "Choose at most eight modules for this host adapter.");
    // Resolve exact current source identities before collecting fields or making any asset RPC request.
    const selected = draft.modules.map(raw => {
      const selection = moduleRecord(raw, ["id", "version", "digest", "configuration"], "foundation.compose.selection");
      const entry = resolveFoundationCatalogEntryV1(catalog, moduleHash(selection.id, "foundation.compose.packageId"));
      foundationRequire(entry.manifest.sourceDescriptor.version === selection.version && entry.manifestHash === selection.digest,
        "FOUNDATION_SELECTION_CHANGED", "The selected source version changed. Choose the current module version again.");
      foundationRequire(entry.status === "available" && entry.release?.chainId === FOUNDATION_CHAIN_ID
        && entry.release.hostAdapterId === FOUNDATION_HOST_ADAPTER_ID_V1,
      "FOUNDATION_SELECTION_UNAVAILABLE", "The selected module has no current verified release for this host.");
      const configuration = raw.configuration;
      foundationRequire(configuration && typeof configuration === "object" && !Array.isArray(configuration),
        "FOUNDATION_FORM_SHAPE", "Module configuration must be a field-value record.");
      return { entry, configuration: Object.fromEntries(Object.entries(configuration).filter(([key]) => key !== FOUNDATION_CREATOR_SHARE_FIELD_V1)) };
    });
    foundationRequire(new Set(selected.map(({ entry }) => entry.runtime.descriptor.moduleId)).size === selected.length,
      "FOUNDATION_MODULE_DUPLICATE", "Choose each module identity once.");
    const client = createFoundationClient(), checkpoint = await assertFoundationInfrastructure(client, binding);
    const quote = await readFoundationQuote(client, getAddress(draft.quoteAsset), account, checkpoint.blockNumber);
    const context: OpenConfigContext = { roles: { creator: account },
      assets: { quote: { chainId: FOUNDATION_CHAIN_ID, address: quote.address, decimals: quote.decimals } },
      components: { factory: binding.factory.address,
        ...Object.fromEntries(Object.entries(FOUNDATION_INFRASTRUCTURE).map(([role, pin]) => [role, pin.address])) } };
    const addresses = selected.flatMap(({ entry, configuration }) => foundationAssetAddressesForFieldsV1({
      schema: entry.manifest.sourceDescriptor.configuration, defaults: entry.runtime.defaults, configuration, context,
      deferredAssetKeys: ["token"],
    }));
    // One global bound applies across all selected modules, including defaults and fixed source values.
    const resolved = await resolveFoundationAssetsV1({ client, addresses, context, checkpoint });
    const moduleAssetPins = resolved.pins;
    const metadata = foundationMetadata({ ...draft, imageURI: draft.image.url,
      modulePackageIds: selected.map(({ entry }) => entry.manifest.packageId), moduleAssetPins });
    const token = await client.readContract({ address: binding.factory.address, abi: foundationFactoryAbiFor(binding), functionName: "predictTokenAddress",
      args: [account, body.tokenSalt, metadata], blockNumber: checkpoint.blockNumber });
    foundationRequire(getAddress(token) !== quote.address && !moduleAssetPins.some(([address]) => getAddress(address) === getAddress(token)),
      "FOUNDATION_ASSET_CONTEXT_CONFLICT", "The predicted coin overlaps an existing asset. Prepare with a new launch salt.");
    const finalContext: OpenConfigContext = { ...resolved.context, assets: { ...resolved.context.assets,
      token: { chainId: FOUNDATION_CHAIN_ID, address: token, decimals: 18 } } };
    for (const { entry, configuration } of selected) {
      const schema = entry.manifest.sourceDescriptor.configuration;
      const value = decodeFoundationFieldsV1(schema, configuration, entry.runtime.defaults, finalContext);
      // The compiler can insert fixed values inside structured inputs. Check those bindings as well.
      for (const assetBinding of compileOpenConfig(schema, value, finalContext).bindings) if (assetBinding.kind === "asset") {
        const { asset } = foundationAssetForAddressV1(assetBinding.resolved.address, finalContext, assetBinding.path);
        foundationRequire(String(asset.chainId) === assetBinding.resolved.chainId && asset.decimals === assetBinding.resolved.decimals,
          "FOUNDATION_ASSET_METADATA_MISMATCH", "The source asset metadata differs from the verified metadata.", assetBinding.path);
      }
    }
    const composition = composeFoundationUiSelectionsV1({ catalog,
      selections: draft.modules, creatorFeeBps: draft.creatorFeeBps, chainId: FOUNDATION_CHAIN_ID, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1,
      context: finalContext });
    if (!composition.ok) return NextResponse.json({ error: "The selected modules cannot be composed.", diagnostics: composition.diagnostics }, { status: 422, headers });
    return NextResponse.json({ releaseDigest: binding.releaseDigest, token, metadata, moduleAssetPins, modules: composition.modules,
      compositionHash: composition.compositionHash, totals: composition.totals }, { headers });
  } catch (error) {
    const message = error instanceof Error && error.message.length < 240 ? error.message : "This launch could not be prepared. Check its details and retry.";
    return NextResponse.json({ error: message }, { status: 400, headers });
  }
}
