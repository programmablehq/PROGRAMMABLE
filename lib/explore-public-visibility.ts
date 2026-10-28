type EvidenceBoundExploreExclusionV1 = Readonly<{
  identity: string;
  evidence: string;
  kind: "release-canary-token";
}>;

/**
 * Discovery exclusions are limited to identities that the repository's
 * canonical release evidence explicitly classifies as canaries. Display
 * names, symbols, creators, liquidity and market activity are deliberately
 * excluded from this policy because none of them proves launch intent.
 */
export const NON_PUBLIC_EXPLORE_IDENTITIES_V1 = Object.freeze({
  tokens: Object.freeze([
    Object.freeze({
      identity: "0xB382f738a99820276FD66EfB94b75Eca104c2B4D",
      evidence:
        "contracts/deployments/mainnet-classic-v4.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0xFA5D9694D9f8fa47b8A6c15Df4510b76cb844e2c",
      evidence:
        "contracts/deployments/mainnet-classic-v3.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x3a778578b3a21dd842c29be3d1816b1af37d54f3",
      evidence:
        "contracts/deployments/mainnet-deep-full-range-v1.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x3C82787014931BD11b9edb789E42F92d792Dd07f",
      evidence:
        "contracts/deployments/mainnet-stock-paired-v1.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x369f5fa21942560c42Ba9FDb8a156F5C962BD2eC",
      evidence:
        "contracts/deployments/mainnet-stock-paired-v2.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x2C348590Cb56Fcc5984F035D57bdb01e32c945D5",
      evidence:
        "contracts/deployments/mainnet-stock-paired-v3.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x9DEeB39D2590b0cAD5fc473F755C5F97Dcc8f7cE",
      evidence:
        "components/launch-stamp-docs-contract.ts#PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter.canaryEvidence.components.token",
      kind: "release-canary-token" as const,
    }),
  ] satisfies readonly EvidenceBoundExploreExclusionV1[]),
});

const NON_PUBLIC_TOKEN_ADDRESSES = new Set(
  NON_PUBLIC_EXPLORE_IDENTITIES_V1.tokens.map(({ identity }) =>
    identity.toLowerCase()),
);

// Owner-requested discovery exclusions are separate from release canaries.
// A matching address on another chain and future verified launches stay visible.
export const OWNER_HIDDEN_EXPLORE_IDENTITIES_V1 = Object.freeze([
  Object.freeze({ chainId: 4663, identity: "0x9396d34417f19acd4c6de6c260b48201a6e4f8cf" }), // Owned public-metadata release check; review 03f8757a-7ec0-4a5b-bfcb-bc72b869f28a
  Object.freeze({ chainId: 4663, identity: "0x5ed37df5710e20baf324519266390f7653665759" }), // Owned review-read performance release check; review 7ffe05e7-6cf2-4985-ba33-cd684c02158d
  Object.freeze({ chainId: 4663, identity: "0xb9338137dcc772944c4e357441d55a4bce49b49b" }), // Owned reconciliation release check; review addee5f6-aea1-4ced-8b41-3d01233ec4b7
  Object.freeze({ chainId: 4663, identity: "0x7570dafbde30dab0ed05c6a49330c2d2552e8a93" }), // Owned 0.3% restoration release check
  Object.freeze({ chainId: 4663, identity: "0xf1c780d1db22fab8124f85abd3132df4299c3f9a" }), // Owned source-publication recovery check; review caba5178-61c2-4ab0-82a7-64e26b2b1f60
  Object.freeze({ chainId: 4663, identity: "0xfc65fb2ad4fe188d6529ba23f8083fc34e5961b7" }), // Owned Native100 release check; review 5929e544-4ee3-485d-802a-98b6270a3249
  Object.freeze({ chainId: 1, identity: "0x9e7791ac645e902da1fa94451d3034e351e1aae7" }), // Owned fee100 Module Mode release check; deterministic token in platform-fee100-20261012
  Object.freeze({ chainId: 4663, identity: "0xb1e6e441214d3bfb7a073f8095632ab20b9d2b42" }), // Owned fee-policy release check; review 2e2537d8-a5a8-49df-8ef1-43d6f54c260e
  Object.freeze({ chainId: 4663, identity: "0x7e76d9b7c153fd29e87ef0b339ba44e84be5f276" }), // Owned runtime-continuation release check; bound to review 36942122-37fb-4ecd-ad0c-0ddfce50d051
  Object.freeze({ chainId: 4663, identity: "0xc657ade283727d6ad1ae85cdb888c47d751e8ab8" }), // Owned review-cache release check; bound to review d2c8670e-dc49-4c57-9030-d3174d09fae4
  Object.freeze({ chainId: 4663, identity: "0x0e6990f83be3b72adbece8a870b7264510ce3e46" }), // Owned child-effect release check; deterministic token bound to review 14057e62-580a-4f99-9406-7c33b426f84d
  Object.freeze({ chainId: 4663, identity: "0x40ad95a531caf7657fc40c50c3d6dbdad6f70baf" }), // Owned API readiness release check; deterministic token bound to review 946ba9ca-ca89-49be-b4f0-8306f2e0680e
  Object.freeze({ chainId: 4663, identity: "0xe5335f382444efdedbe23ef6b0b91ea385812b57" }), // Owned launch-operations release check; deterministic token bound to review 00adf0c8-0054-4075-83b9-d88d617f83f7
  Object.freeze({ chainId: 4663, identity: "0xe0a557b41a13dd0ff3378c13ac700d7515cc79e8" }), // Preparation-feedback release check; tx 0x05572442b8ea459bf2ee2e2583bfa5f8d66fe9a065e40aac562fdbabef1713d9
  Object.freeze({ chainId: 4663, identity: "0x734b0dc83c29b9da80d5c733815f705a8b6f9d5e" }), // Manual-review checkpoint release check
  Object.freeze({ chainId: 4663, identity: "0x8b69fd6e401039e45444eea5d99e59a4122d859a" }), // Source-verification release check
  Object.freeze({ chainId: 4663, identity: "0xf9261d85c503927bf70916a6594a33979e614ec3" }), // Replacement admission API release check
  Object.freeze({ chainId: 4663, identity: "0x2a0836901fd30be8de47b9c199c6acf2ba372305" }), // Economic module API release check
  Object.freeze({ chainId: 4663, identity: "0x7a73888170d3de8e10ebd78d4e6a685eaa92c9f4" }),
  Object.freeze({ chainId: 4663, identity: "0x76f71862c7646c3f6a54312a0889097a7334a8c0" }), // Compiler and atomic-stamp release canary
  Object.freeze({ chainId: 4663, identity: "0xee5d9574c8d5e07599d6012b34e5a189714c9021" }), // PMCHECK reliability release canary
  Object.freeze({ chainId: 4663, identity: "0x1928ba9532fe73d331f309faffa56a0f76238828" }), // Owned MODLIVE release check; launch 4922312d-21de-4311-b1ee-2684944aee65
  Object.freeze({ chainId: 4663, identity: "0xb2b92ec4f4fb8ac02edd65ae8f677974f31f5f17" }), // Owner-approved PMRC28 reliability release check
  Object.freeze({ chainId: 1, identity: "0x1a6a3948b0c54670b634dd2a54598793ee192895" }),
  Object.freeze({ chainId: 1, identity: "0xe2f175af5edf2ba4793ecdad94888fcdc5e1ab5f" }),
  Object.freeze({ chainId: 1, identity: "0xface73b63787960282f2d4682d3752beb25271ad" }),
  Object.freeze({ chainId: 1, identity: "0x705f60fadb9728ca976e727ae9d746cc4d303be2" }), // ETH 3.6 release canary
  Object.freeze({ chainId: 1, identity: "0xbb73f3bb5cfae5629f0a6a58bb10ab1e35e4c11a" }), // Atomic module-stamp release canary
  Object.freeze({ chainId: 1, identity: "0x2bbc1677a495746a7fad51851dcba8bc37c5a213" }), // WECWDCWDE
  Object.freeze({ chainId: 1, identity: "0x3d2315f1869518129b508a55f86d0afcb2fefba6" }), // Old DNA launch; owner requested removal before relaunch

  // Owner-requested test-launch cleanup. These identities remain addressable
  // for evidence and direct token pages, but must not appear in discovery.
  Object.freeze({ chainId: 1, identity: "0x35b02f403639f16c790c6d057977907ebe5582ed" }), // Automated launchpad integration test
  Object.freeze({ chainId: 1, identity: "0x075fdfbe6b111df5372570faa2dcb9c4774381ed" }), // Automated launchpad integration test
  Object.freeze({ chainId: 1, identity: "0xb6e6d5090af2a858dbefce719f255376086e5b61" }), // Automated launchpad integration test
  Object.freeze({ chainId: 1, identity: "0xe6fbc98b9cd4b38c25617396b03375d7519c62ef" }), // Automated launchpad integration test
  Object.freeze({ chainId: 1, identity: "0xc4783849874f8e601454abefc316d105904005da" }), // PTest integration launch
  Object.freeze({ chainId: 1, identity: "0x1a35f0d9987f02fae08a0bd2b1205080e021ab66" }), // PTest integration launch
  Object.freeze({ chainId: 1, identity: "0xe9d2dcad31d7e87e5b9ee76182cdc8e7942721fb" }), // PTest integration launch
  Object.freeze({ chainId: 1, identity: "0xe3d06d7446851f3b0d9bba94da2922f6913ff6b3" }), // PTest integration launch
  Object.freeze({ chainId: 1, identity: "0xf9cb2c7140385105e66867eeb0415410942bff6c" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0x9520dc80fe4bdb9ec1928180f21b7bc97d27663b" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0x8570c3b5eed7648d60335d4151b12496f8d8d5d7" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0x2b1ce2f74916ba8a1f9907a24e06f72c4afadb20" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0x8faa84e9bf42b646839fbe528120395d44467cbf" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0xcd21df914520bd7e6fc4a479cda1b06b86e43cf4" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0x0ea15760d87e7a4463ebf5ff6c087e327364bfe8" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0xbf27b9b1b41a5675715e2d5f8481b4d6749e4ef6" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0xbff08387c043d705cb3da69078286e9ad072dc25" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0x12c54facdaebca263edbb97e44970bcc5c36e1b3" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0xe2a097ae052ac69ed7f630c79444486a99705dc2" }), // Internal economic module test
  Object.freeze({ chainId: 1, identity: "0x9f461aa7d0685c8060c1f610733e1e8cc3406a4f" }), // NOOP test
  Object.freeze({ chainId: 1, identity: "0xf6091b94cc55a701f85df1d22ae955b7b6a3714b" }), // NOOP test
  Object.freeze({ chainId: 1, identity: "0xfac755519ea81edcf5d202a9080c75f22eeaa4d9" }), // Internal test wallet
  Object.freeze({ chainId: 1, identity: "0xa3a28c0b5256b4176539c8bd6d8a87317a1fc0e1" }), // Internal test wallet
  Object.freeze({ chainId: 1, identity: "0xb796973e3b56cb772557e4155f8113486a7b08b4" }), // Internal test wallet
  Object.freeze({ chainId: 1, identity: "0xd160a6c97738d138a63f8948c46072561e6e20f2" }), // Internal test wallet
  Object.freeze({ chainId: 1, identity: "0x6c066c38b3335efef3bd5d35a11254c9cad70aad" }), // Internal test wallet
  Object.freeze({ chainId: 1, identity: "0xc5a0547a548f5a0121e376c7a970176ef490f8bc" }), // Internal test wallet
  Object.freeze({ chainId: 1, identity: "0xaa346ba40e01de46650e9ca2fb984fbb2be14fa1" }), // Internal test wallet
  Object.freeze({ chainId: 1, identity: "0x9160aa5cbfc50e4bc2aea5a1207cb222fee40921" }), // Internal test wallet
  Object.freeze({ chainId: 1, identity: "0x8a7773c9922ad003bee4eefa4e9e924c80a25a2f" }), // Internal test wallet
  Object.freeze({ chainId: 1, identity: "0x57b8e3a2eb94e684b1f92582a6be8a9d54039956" }), // Test wallet
  Object.freeze({ chainId: 1, identity: "0x65a2365e89b596d4b4c17153a75d700cd5f0ee04" }), // Test wallet
  Object.freeze({ chainId: 1, identity: "0xf3a6a1edc6f8467c82051b351434bfa79321c070" }), // Test wallet
  Object.freeze({ chainId: 1, identity: "0x90c453484bc56a625e15eb0e242ca4e23ac74e7c" }), // Test wallet
  Object.freeze({ chainId: 1, identity: "0xc43074a8a71d9e2d5589de0aff89e6928538eb5e" }), // Test wallet
  Object.freeze({ chainId: 1, identity: "0x621268e6a4c8252e95412bdc566c061d94280724" }), // Test wallet
  Object.freeze({ chainId: 1, identity: "0x3f2a426365e7a438a7f9f758766cff419d207d51" }), // Ballistic WETH canary

  Object.freeze({ chainId: 4663, identity: "0xa9ffffc4e36fe012d8d96331694d41d48d6fd7b4" }), // Agent Live Test
  Object.freeze({ chainId: 4663, identity: "0xd4132d925a1dcea204a63f61ed8aafef8436e269" }), // Anemone Test
  Object.freeze({ chainId: 4663, identity: "0xefa84357e79d60e138c6c30f15a034b917db4abd" }), // testt
  Object.freeze({ chainId: 4663, identity: "0x086ccbd3f9f99218ff78f434bbc2d05f7b5bbe89" }), // PROGRAM TEST
  Object.freeze({ chainId: 4663, identity: "0x9deb2e97d4febbbccddd3d79a96442d0f10e87c5" }), // TEST
  Object.freeze({ chainId: 4663, identity: "0x22c776bdb4f98df9d861e8459c7ae97ba9ae1418" }), // TEST launch; do not buy
  Object.freeze({ chainId: 4663, identity: "0x39586e87a6c6ba3792623c87a953c23de1ea6df4" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0x35e84e8fc9be6d41b2ff4bb1bf9cd91c3acee39a" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0x227d474c862a4b18d3d4124380fbdefcd92b6b78" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0x347963f0b691737336b62e3f9716427ca6834bb3" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0xf966309e5a68d9780fc5b8cb69c057af0e9e80d8" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0x6086b43cba4a1b29ae473eb825372f27ac16e8c4" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0xf46425abb4695ea14b3c1f4c1dd4b9a58b1ed856" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0x579f901530b51952b304d8d9cb79ad29a8a736b3" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0xbfa9435db13e25a7895b248aff3528a525fe348a" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0xfd4328446647fd24b0a4812934eda831a4868664" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0x4b20e72aa3e08cf0de5854cd5909086a5b397a67" }), // Internal economic module test
  Object.freeze({ chainId: 4663, identity: "0x72035572d84975cf74d90bcc4b46cedacd4335a2" }), // Programmable API Guard Check
  Object.freeze({ chainId: 4663, identity: "0xa3470b7669fb005956f10b795a4b7cff6d0eb340" }), // Programmable Review Check
  Object.freeze({ chainId: 4663, identity: "0x2e937410f4c8c30b85e75a5b230229ca1bd3a9f3" }), // Programmable Review Check
  Object.freeze({ chainId: 4663, identity: "0xa0f1a302e0b0b001d5ee71b3e941b608e104e1a1" }), // Programmable Review Check
  Object.freeze({ chainId: 4663, identity: "0xea4386153786d1c7ed157805848baf8898d7aadd" }), // Programmable Base API Check
  Object.freeze({ chainId: 4663, identity: "0xb720f1b98ed19afee4ab8a0f78c28f74c149eee4" }), // Programmable Base API Check
  Object.freeze({ chainId: 4663, identity: "0x3ee682fc9c43336f508de388bbd65ddca43d29eb" }), // Programmable API Fix Check
  Object.freeze({ chainId: 4663, identity: "0xc6e83d8b2d87399eb0a97a07c324c57e1cd33b68" }), // Programmable API Fix Check
  Object.freeze({ chainId: 4663, identity: "0xd74bed0f37b303d25e70fde0057be968d289ef52" }), // Programmable API Release Check
  Object.freeze({ chainId: 4663, identity: ["0x49885ab6a28b63e21c9c68ddd2946a", "5d034881e0"].join("") }), // Custom AI Test
  Object.freeze({ chainId: 1, identity: ["0x9a5c5a7c582d7d7729c7e10b6e65b3", "27e50a77e1"].join("") }), // Custom AI Test
  Object.freeze({ chainId: 4663, identity: "0x3f54538ffbfb5890be60f17aed98cb309f902377" }), // Protected Launch 15K Six
  Object.freeze({ chainId: 4663, identity: "0xd3e63c1a6e9e5946d52e488b90fac394afaf208b" }), // Protected Launch Canary 2 / GUARD2
  Object.freeze({ chainId: 4663, identity: "0x67624555c2bb3627b54ae677b35ba73bf37908c8" }), // Protected Launch Canary / GUARD
  Object.freeze({ chainId: 4663, identity: "0x5eec290834f7245f845f2047ec7be96415bf0137" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0x4140515cbe7bd50d4416a5950f290b76ac9c4026" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0xf75c25a0d60572c41f3fdcc8ae4b119c8a142164" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0x103a04145c9fa7093e639ad15183170304c42eb0" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0x6008c81e34ec10c13897876653077d768bcacfb5" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0xcd3a24f0e88d0d90ff5b1ce91c4ac78e7ee66b05" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0x8e7667d01b670b117b84c5086d45e93eee1f715d" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0x6bf4415e1155d177f9f5968f1059bf084b72b9d4" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0x64de4965ddd715fb011cebd727b1458fc820bd34" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0x226d0014c0fbd6be0dfce5322102b25680db9500" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0xd5cead34df9db8537e88d9ffdf522664dee7cdac" }), // Programmable Native30 Canary
  Object.freeze({ chainId: 4663, identity: "0x3f4c4ab2bfecebfcab9c578b38a0311dfb56033e" }), // Programmable Native30 Canary
]);
/**
 * Controls only public discovery. Direct token lookup remains available so
 * historical evidence and exact-address access are preserved.
 */
export function isPublicExploreIdentityV1(
  identity: Readonly<{ tokenAddress?: string }>,
  chainId: number = 1,
): boolean {
  if (
    typeof identity.tokenAddress === "string" &&
    NON_PUBLIC_TOKEN_ADDRESSES.has(identity.tokenAddress.toLowerCase())
  ) {
    return false;
  }
  if (OWNER_HIDDEN_EXPLORE_IDENTITIES_V1.some(hidden => hidden.chainId === chainId
    && hidden.identity === identity.tokenAddress?.toLowerCase())) return false;
  return true;
}
