import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LAUNCH_KIND_V1,
  LAUNCH_STAMP_RUNTIME_HASH_DEFINITION,
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_RESOURCES,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ARTIFACT,
  STAMP_RECORD_V1_FIELDS,
} from "../components/launch-stamp-docs-contract";
import { developerDocsMarkdown } from "../lib/developer-docs-content";
import sitemap from "../app/sitemap";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const page = read("app/docs/launch-stamps/page.tsx");
const developerOverview = read("app/docs/developers/page.tsx");
const indexingPage = read("app/docs/developers/indexing/page.tsx");
const styles = read("components/launch-stamp-docs.module.css");
const docsData = read("components/docs-data.ts");
const docsShell = read("components/docs-shell.tsx");

describe("Launch Stamp developer documentation", () => {
  it("publishes the exact live Router activation and finalized evidence", () => {
    expect(PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ARTIFACT).toEqual({
      contractName: "ProgrammableLaunchStampRouterV1",
      sourceCommit: "0a7134bbb912222639627fb9078df2f8dd3a6c38",
      sourceTree: "24ffb0c6b04af7993254560b4f03608de8f52231",
      artifactPath:
        "out/ProgrammableLaunchStampRouterV1.sol/ProgrammableLaunchStampRouterV1.json",
    });
    expect(PROGRAMMABLE_LAUNCH_STAMP_MANIFEST).toEqual({
      chainId: 1,
      launchStampRouter: {
        version: "1",
        generation: "1",
        status: "live",
        address: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
        startBlock: "25717612",
        endBlock: null,
        runtimeCodeHash:
          "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
        finalityConfirmations: 64,
        abiUrl:
          "https://developers.programmable.family/abis/ethereum/programmable-launch-stamp-router-v1.json",
        abiSha256:
          "sha256:bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86",
        bindings: {
          permitAuthority: "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b",
          permitAuthorityRuntimeCodeHash:
            "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
          graphFactory: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
          graphFactoryRuntimeCodeHash:
            "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
          poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
          poolManagerRuntimeCodeHash:
            "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
        },
        events: {
          launchStamped: {
            name: "ProgrammableLaunchStampedV1",
            signature:
              "ProgrammableLaunchStampedV1(bytes32,address,address,address,bytes32,bytes32)",
            topic0:
              "0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2",
            indexedInputs: ["launchId", "token", "hook"],
          },
          launchRouteStamped: {
            name: "ProgrammableLaunchRouteStampedV1",
            signature:
              "ProgrammableLaunchRouteStampedV1(bytes32,uint8,bytes32,bytes32,bytes32)",
            topic0:
              "0x45e7cc355b63ca67d6278a0d8d23470ce2a0741a9c60283d7dee712df7a877a5",
            indexedInputs: ["launchId", "kind", "routePayloadHash"],
          },
          componentStamped: {
            name: "ProgrammableComponentStampedV1",
            signature:
              "ProgrammableComponentStampedV1(bytes32,address,uint8,bytes32)",
            topic0:
              "0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b",
            indexedInputs: ["launchId", "component", "kind"],
          },
        },
        deploymentEvidence: {
          verificationStatus: "finalized-verified",
          address: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
          deploymentTransactionHash:
            "0x3bc086661555c10040feb3fceb23d33003e22ca033e65cfae72592119ee8d486",
          deploymentBlockNumber: "25717612",
          deploymentBlockHash:
            "0x8e4512193217c2171624657717d32dbfe9896455e553cadc192fbfe32d3278bc",
          finalizedBlockNumber: "25717634",
          finalizedBlockHash:
            "0x4177a280cd7e43da181bf1d73900eb2431c26d5fe933a5ed0e583370064cbd6e",
          finalityDepth: 22,
          runtimeCodeBytes: 23013,
          runtimeCodeKeccak256:
            "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
          runtimeCodeSha256:
            "sha256:0b0e89074bff270bd5bf80ca9642f748dca1857d1ab643cbce65f4f663937ec7",
          observedBindings: {
            chainId: 1,
            permitAuthority: "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b",
            permitAuthorityRuntimeCodeHash:
              "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
            graphFactory: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
            graphFactoryRuntimeCodeHash:
              "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
            poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
            poolManagerRuntimeCodeHash:
              "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
          },
          getterBundleSha256:
            "sha256:6e6e8a93193bbe2f79f98594a1af32c27bae0746f8297dd13592d9608e2feb20",
          evidenceSha256:
            "sha256:f9786ebfb74c96a3c225567ad324f0fbecfd8520b8d8addec85ba58cd67e19ff",
        },
        canaryEvidence: {
          finality: "finalized",
          routeCoverage: {
            customGraphOnchainCanary: true,
            classicOnchainCanary: false,
          },
          source: {
            sourceRepository:
              "https://github.com/programmablehq/PROGRAMMABLE",
            sourceCommit: "b3cfed41bb841ae8d6188dbb815eddb5e1440218",
            commitSubject: "Add graph launch stamp canary",
          },
          transactionHash:
            "0xc07b4e70233534a1d4f435ffc9a636ed5f542f4aedcde35052c58224f378b612",
          blockNumber: "25717953",
          blockHash:
            "0x97827b6586f0dca00e44801acc529c3961b4c693988dfc9f4b2bb4c3d94632ba",
          launchId:
            "0x5a52180427785716bff0a36218dde89f0459db265d0c2bdfcfde81a8fe733c92",
          stampHash:
            "0x06cb71b38d9b8b1dd1ffcdb00f31c774be36f5473979c3831d5fd0c96cdaa579",
          launchKind: 1,
          components: {
            initializer: "0x87B108848B444bC44A01734D62C7be4a2fA64983",
            token: "0x9DEeB39D2590b0cAD5fc473F755C5F97Dcc8f7cE",
            hook: "0xEBa46f25DfF528141dE5317109Acb5A989296044",
          },
          pool: {
            poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
            poolId:
              "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229",
            activeLiquidity: "31618002430832353916",
          },
          lpPosition: {
            positionManager: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
            tokenId: "367610",
            owner: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
          },
          platformFee: {
            feePips: 1000,
            recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
          },
          tokenTotalSupply: "1000000000000000000000000",
          stampProofs: [
            {
              component: "0x87B108848B444bC44A01734D62C7be4a2fA64983",
              launchId:
                "0x5a52180427785716bff0a36218dde89f0459db265d0c2bdfcfde81a8fe733c92",
              stampHash:
                "0x06cb71b38d9b8b1dd1ffcdb00f31c774be36f5473979c3831d5fd0c96cdaa579",
            },
            {
              component: "0x9DEeB39D2590b0cAD5fc473F755C5F97Dcc8f7cE",
              launchId:
                "0x5a52180427785716bff0a36218dde89f0459db265d0c2bdfcfde81a8fe733c92",
              stampHash:
                "0x06cb71b38d9b8b1dd1ffcdb00f31c774be36f5473979c3831d5fd0c96cdaa579",
            },
            {
              component: "0xEBa46f25DfF528141dE5317109Acb5A989296044",
              launchId:
                "0x5a52180427785716bff0a36218dde89f0459db265d0c2bdfcfde81a8fe733c92",
              stampHash:
                "0x06cb71b38d9b8b1dd1ffcdb00f31c774be36f5473979c3831d5fd0c96cdaa579",
            },
          ],
          evidenceFileSha256:
            "sha256:1325d1333b6df9545cb87048e2b8d1c57a63af5b6790c329c0e95157a0d16d2c",
          evidenceLineSha256:
            "sha256:615a20b31f454afb020a8fa83653c7685328e3f12ad58d3ac11ddab2d02968b5",
        },
      },
    });
    expect(LAUNCH_STAMP_RUNTIME_HASH_DEFINITION).toContain(
      "EVM Keccak-256 of the deployed runtime bytecode",
    );
    const router = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter;
    expect(PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.chainId).toBe(
      router.deploymentEvidence.observedBindings.chainId,
    );
    expect(router.address).toBe(router.deploymentEvidence.address);
    expect(router.startBlock).toBe(
      router.deploymentEvidence.deploymentBlockNumber,
    );
    expect(router.runtimeCodeHash).toBe(
      router.deploymentEvidence.runtimeCodeKeccak256,
    );
    expect(router.bindings).toEqual({
      permitAuthority:
        router.deploymentEvidence.observedBindings.permitAuthority,
      permitAuthorityRuntimeCodeHash:
        router.deploymentEvidence.observedBindings
          .permitAuthorityRuntimeCodeHash,
      graphFactory: router.deploymentEvidence.observedBindings.graphFactory,
      graphFactoryRuntimeCodeHash:
        router.deploymentEvidence.observedBindings.graphFactoryRuntimeCodeHash,
      poolManager: router.deploymentEvidence.observedBindings.poolManager,
      poolManagerRuntimeCodeHash:
        router.deploymentEvidence.observedBindings.poolManagerRuntimeCodeHash,
    });
    expect(page).toContain("same canonical block as");
  });

  it("publishes the exact terminal discovery and follow contract", () => {
    expect(PROGRAMMABLE_LAUNCH_STAMP_RESOURCES).toEqual({
      discoveryUrl:
        "https://developers.programmable.family/.well-known/programmable.json",
      manifestUrl: "https://developers.programmable.family/api/v2/manifest",
      abiUrl:
        "https://developers.programmable.family/abis/ethereum/programmable-launch-stamp-router-v1.json",
      abiGithubUrl:
        "https://raw.githubusercontent.com/programmablehq/Developers/main/abis/ethereum/programmable-launch-stamp-router-v1.json",
      abiSha256:
        "sha256:bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86",
      referenceUrl:
        "https://github.com/programmablehq/Developers/blob/main/docs/reference/launch-stamp.md",
      terminalGuideUrl:
        "https://github.com/programmablehq/Developers/blob/main/docs/guides/terminals-and-scanners.md",
      jsonRpcVerifierUrl:
        "https://github.com/programmablehq/Developers/blob/main/examples/verify-launch-stamp.mjs",
      viemVerifierUrl:
        "https://github.com/programmablehq/Developers/blob/main/examples/verify-launch-stamp-viem.ts",
    });
    expect(page).toContain("eth_getLogs filter");
    expect(page).toContain("eth_chainId == 0x1");
    expect(page).toContain('fromBlock: "0x1886b6c"');
    expect(page).not.toContain("chainId,\n    address: router.address");
    expect(page).toContain("requireCanonical: true");
    expect(page).toContain("last common finalized checkpoint");
    expect(page).toMatch(/Classify only from[\s\S]*record\.kind/);
    expect(page).toContain("record.kind");
    expect(page).toContain("Decode each log by its matched signature");
    expect(page).toContain("correlate the three");
    expect(page).toContain("ProgrammableLaunchStampedV1");
    expect(page).toContain("non-indexed PoolManager, poolId, and stampHash");
    expect(page).toContain("router.finalityConfirmations");

    expect(indexingPage).toContain("Backfill and continue from a checkpoint");
    expect(indexingPage).toContain("Read bounded");
    expect(indexingPage).toContain(
      "exact Router emitter and published topic signatures",
    );
    expect(indexingPage).toContain("Correlate the three event types by");
    expect(indexingPage).toContain("identity-specific token or pool lookup");
    expect(indexingPage).toContain("overlapping checkpoint");
    expect(indexingPage).toContain(
      "Deduplicate identical block, transaction and log coordinates",
    );
    expect(indexingPage).toContain("last common finalized checkpoint");
    expect(indexingPage).toContain("ORPHANED");
    const eventContract = JSON.stringify(
      PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter.events,
    );
    expect(eventContract).toContain(
      "0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2",
    );
    expect(eventContract).toContain(
      "0x45e7cc355b63ca67d6278a0d8d23470ce2a0741a9c60283d7dee712df7a877a5",
    );
    expect(eventContract).toContain(
      "0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b",
    );
  });

  it("publishes the artifact-exact terminal signatures and selectors", () => {
    expect(PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI).toEqual({
      bindingReads: [
        {
          label: "Router chain ID",
          signature: "CHAIN_ID()",
          selector: "0x85e1f4d0",
          returns: "uint256 chainId",
        },
        {
          label: "Permit authority",
          signature: "PERMIT_AUTHORITY()",
          selector: "0xc3a3d03c",
          returns: "address permitAuthority",
        },
        {
          label: "Permit authority runtime",
          signature: "PERMIT_AUTHORITY_RUNTIME_CODE_HASH()",
          selector: "0xa497c61c",
          returns: "bytes32 runtimeCodeHash",
        },
        {
          label: "Graph Factory",
          signature: "GRAPH_FACTORY()",
          selector: "0x1cc9e5ce",
          returns: "address graphFactory",
        },
        {
          label: "Graph Factory runtime",
          signature: "GRAPH_FACTORY_RUNTIME_CODE_HASH()",
          selector: "0x92989a00",
          returns: "bytes32 runtimeCodeHash",
        },
        {
          label: "PoolManager",
          signature: "POOL_MANAGER()",
          selector: "0x62308e85",
          returns: "address poolManager",
        },
        {
          label: "PoolManager runtime",
          signature: "POOL_MANAGER_RUNTIME_CODE_HASH()",
          selector: "0x38d831c4",
          returns: "bytes32 runtimeCodeHash",
        },
      ],
      market: {
        label: "Sole market-bearing write",
        signature:
          "launchAndStampV1((uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes)",
        selector: "0xe5f6b8cd",
        returns: "bytes32 stampHash",
      },
      primaryReads: [
        {
          label: "Token to launch ID",
          signature: "launchIdByToken(address)",
          selector: "0x1dad847c",
          returns: "bytes32 launchId",
        },
        {
          label: "Market to launch ID",
          signature: "launchIdByPool(address,bytes32)",
          selector: "0x361df6f3",
          returns: "bytes32 launchId",
        },
        {
          label: "Launch ID to record",
          signature: "launchStamp(bytes32)",
          selector: "0x4c9e4764",
          returns: "StampRecordV1",
        },
      ],
      componentReads: [
        {
          label: "Exclusive-component proof",
          signature: "stampProof(address)",
          selector: "0x174b9f9d",
          returns: "(bytes32 launchId, bytes32 stampHash)",
        },
        {
          label: "Exclusive-component lookup",
          signature: "launchIdByComponent(address)",
          selector: "0x58c5e373",
          returns: "bytes32 launchId",
        },
        {
          label: "Recorded component runtime",
          signature: "componentRuntimeCodeHash(address)",
          selector: "0xc892d353",
          returns: "bytes32 runtimeCodeHash",
        },
      ],
    });
  });

  it("uses token or PoolManager and poolId as the universal recognition inputs", () => {
    expect(page).toContain("token or (PoolManager, poolId)");
    expect(page).toContain('"          ? launchIdByToken(token)"');
    expect(page).toContain('"          : launchIdByPool(PoolManager, poolId)"');
    expect(page).toContain('"step 2  record := launchStamp(launchId)"');
    expect(page).toContain("ABI-bound read sequence");
    expect(page).toContain("Ethereum deployment · finalized reads");
    expect(page).toContain("resolve one finalized canonical block");
    expect(page).toContain("immutable bindings to match the manifest");
    expect(page).toContain("launchIdByToken(token)");
    expect(page).toContain("launchIdByPool(PoolManager, poolId)");
    expect(page).toContain("launchIdByComponent(component)");
    expect(page).toContain("stampProof(component)");
    expect(page).toContain("componentRuntimeCodeHash(component)");
  });

  it("documents stampProof as exclusive-component corroboration, never a hook route", () => {
    expect(page).toContain("stampProof(address)");
    expect(page).toMatch(/A Classic hook\s+is shared/);
    expect(page).toContain("There is no universal hook getter");
    expect(
      JSON.stringify(PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI),
    ).not.toContain("launchIdByHook");
    expect(page).not.toContain("hook → launchId");
  });

  it("freezes StampRecordV1 tuple order and LaunchKindV1 encoding", () => {
    expect(STAMP_RECORD_V1_FIELDS).toEqual([
      ["uint8", "kind"],
      ["address", "launchWallet"],
      ["address", "token"],
      ["address", "hook"],
      ["address", "poolManager"],
      ["bytes32", "poolId"],
      ["bytes32", "poolKeyHash"],
      ["bytes32", "componentSetHash"],
      ["bytes32", "routePayloadHash"],
      ["address", "routeLauncher"],
      ["bytes32", "routeLauncherRuntimeCodeHash"],
      ["bytes32", "expectedResultHash"],
      ["bytes32", "permitDigest"],
      ["bytes32", "stampHash"],
    ]);
    expect(LAUNCH_KIND_V1).toEqual([
      { value: 0, name: "Invalid", publicLabel: null },
      { value: 1, name: "CustomGraph", publicLabel: "Programmable Custom" },
      { value: 2, name: "Classic", publicLabel: "Programmable Classic" },
    ]);
    expect(page).toContain("LaunchKindV1.CustomGraph");
    expect(page).toContain("LaunchKindV1.Classic");
  });

  it("limits stamps to Router-stamped Classic and Custom provenance", () => {
    expect(page).toMatch(/before (?:this )?Router(?:'s|&apos;s)? start block/i);
    expect(page).toMatch(
      /Safety, tradability, current pool state, current liquidity, audit\s+coverage, review status/,
    );
    expect(page).toContain(
      "A Registry, indexer, Supabase project, Programmable API, or",
    );
    expect(page).toContain(
      "This point-in-time test case covers the CustomGraph route",
    );
    expect(page).toContain("The published evidence does not include");
    expect(page).toMatch(/a separate Classic\s+onchain canary/);
    expect(page).toMatch(
      /Router-stamped Classic launches\s+use the same\s+published\s+Router\s+ABI/,
    );
    expect(page).toMatch(
      /Direct Classic Factory, Graph Factory, or Single Factory\s+calls/,
    );
    expect(page).toMatch(
      /does not automatically list a token in GMGN, Axiom, FOMO/,
    );
    expect(page).toMatch(
      /Generic pool or token discovery in a third-party API is not Router\s+stamp integration/,
    );
    expect(page).toMatch(
      /GMGN market\s+numbers are not canonical onchain stamp\s+evidence/,
    );
    expect(page).toMatch(
      /read current\s+pool state separately through\s+PoolManager\s+or\s+StateView/,
    );
    expect(page).toContain("slot0.sqrtPriceX96 == 0");
    expect(page).toContain("slot0.sqrtPriceX96 != 0");
    expect(page).toMatch(/not current pool state or liquidity/);
    expect(page).toMatch(
      /does\s+not claim that every\s+component was newly created/,
    );
    expect(page).toContain("not an Explorer source");
    expect(page).toContain("supplied handoff digests");
    expect(page).toMatch(/PCAN.*token symbol in this test case/s);
    expect(page).toContain("does not replace it");
    expect(page).toMatch(
      /Custom launch\s+preparation uses a scoped wallet, partner-root or partner-subkey\s+credential and the authenticated API/,
    );
    expect(page).toContain('href="/docs/trust"');
    expect(page).toContain('href="/docs/creators/launch"');
    expect(page).not.toContain("Classic onchain canary passed");
  });

  it("keeps the Router reference in Infrastructure and linked from Developers", () => {
    expect(docsData).toContain('href: "/docs/launch-stamps"');
    expect(docsData).toContain('label: "Launch Stamp Router"');
    expect(docsData).toContain("const programmablePaths = [");
    expect(docsData).toContain('"/docs/launch-stamps"');
    expect(docsShell).toContain(
      "item.relatedPaths.some((path) => path === currentPath)",
    );
    expect(page).toContain('currentPath="/docs/launch-stamps"');
    expect(developerOverview).toContain('href="/docs/launch-stamps"');
    expect(docsShell).toContain('aria-label="Breadcrumb"');
    expect(page).toContain('alternates: { canonical: "/docs/launch-stamps" }');
    expect(sitemap().map(({ url }) => url)).toContain(
      "https://programmable.market/docs/developers/machine-readable/launch-stamps",
    );
    expect(developerDocsMarkdown).toContain(
      "[GitHub Router reference](https://github.com/programmablehq/Developers/blob/main/docs/reference/launch-stamp.md)",
    );
    expect(developerDocsMarkdown).toContain(
      "Only launches executed and stamped through this Router inside its published block range",
    );
    expect(developerDocsMarkdown).toContain(
      "direct factory calls outside the Router even when later, do not",
    );
    expect(developerDocsMarkdown).not.toContain(
      "the binding remains prelaunch until every deployment field is published",
    );
  });

  it("keeps the expanded reference semantic and reflow-safe", () => {
    expect(page).toContain('aria-labelledby="trust-root-heading"');
    expect(page).toContain("<dl className={styles.definitionList}>");
    expect(page).toContain(
      '<pre aria-label="Launch stamp verifier pseudocode using the frozen ABI">',
    );
    expect(page).toContain('aria-label="StampRecordV1 fields in ABI order"');
    expect(page).toContain("<ol");
    expect(page).not.toContain('role="img"');
    expect(styles).toContain("@media (max-width: 700px)");
    expect(styles).toContain("@media (max-width: 360px)");
    expect(styles).toContain("env(safe-area-inset-bottom)");
    expect(styles).toContain("var(--body-background) 88%");
    expect(styles).toMatch(
      /\.signatureList dd\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /\.referenceList dt,\s*\.definitionList dt,\s*\.signatureList dt,[\s\S]*?\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s,
    );
    expect(styles).toMatch(
      /\.signatureList dd > code,\s*\.signatureList dd > span,\s*\.signatureList dd > span code\s*\{[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s,
    );
    expect(styles).toMatch(
      /\.detailLine code,\s*\.detailLine a\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s,
    );
    expect(styles).not.toContain("transition: all");
    expect(styles).not.toMatch(
      /font-size:\s*(?:10(?:\.5)?|11(?:\.5)?|12(?:\.5)?)px/,
    );
    expect(styles).not.toMatch(/\n\s+width:\s*\d{3,}px/);
  });
});
