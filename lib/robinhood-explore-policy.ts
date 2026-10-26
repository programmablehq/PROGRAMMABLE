import { OWNER_HIDDEN_EXPLORE_IDENTITIES_V1 } from "./explore-public-visibility";

// Explore pins the canonical Programmable token on Robinhood Chain.
export const PINNED_ROBINHOOD_CHAIN_ID = 4663;
export const PINNED_ROBINHOOD_TOKEN = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";

// Requested Explore exclusions do not remove canonical launch records or coin pages.
// Cleanup of existing Explore entries on 2026-10-03. New verified launches remain discoverable.
const EXPLORE_EXCLUDED_TOKENS = new Set([
  ...OWNER_HIDDEN_EXPLORE_IDENTITIES_V1.filter(hidden => hidden.chainId === PINNED_ROBINHOOD_CHAIN_ID)
    .map(hidden => hidden.identity.toLowerCase()),
  "0x0168a810799cc1ad92c59747c653fb812d05138a",
  "0x022e6a6858aceec7ac7f44565d54d614fcc039b2",
  "0x1760a069be03a72bd8b055f5127540eb1e4e9403",
  "0x1cc125025a162c4e3271955c305a01a138f936d3",
  "0x24535e7b627ca1c03ef22fb493883e9d7d6df2e4",
  "0x24d591ca32b988fc508a365b594f407be7934754",
  "0x283b03bfaa9365daaeac7eb17ad07c6ef9c97cb2",
  "0x2cce608219d32ea1eb6c7ea4d04a0eacd1f08da9",
  "0x2ea45edf16450ff7a138a38baf04a05fcab4d3dd",
  "0x34cd7dd63c550a78a3228c199474189b88565ac9",
  "0x34d83256b9bc41a807615899a09035b1f03f2b7a",
  "0x370120d0bd26f8c5a19042aa376cefd4863bc32b",
  "0x371eca3375d9f83ef6b2fe5166f9be8590732d86",
  "0x41619a44332e85bde1df2a4d3e3bf9777212ea59",
  "0x450012615c3c88fa36bade6a5e9f0dd491b6d050",
  "0x4567baf4d9941beb19a8a16cea36ee3fe020cbe9",
  "0x4c073dce4a90665e738ca48adfc9c9dc8cdd4fe1",
  "0x50468e7840b2847e025b4850680eacd9626f35c9",
  "0x5664070888bc5c7e3053cbce7bfe4f87c3b58b2b",
  "0x624a052063f4a1c88a33305502a409fe619a9c40",
  "0x62e17179943b098d0f53d3f68a78fee2a7506fd9",
  "0x635d3e23e0f8ba5ac6898dcf3115c5597a239cc1",
  "0x6489cc9676eaa4093a150b9af961e5ec2b467ad8",
  "0x64e18429b830379b81e15b7fd0041c0d8b9b110c",
  "0x6813d5187ec2d0f4abc10a1266b6b62a5adca3d8",
  "0x6de28377117cd40f1555e2588665688f8de50a62",
  "0x6eee1e87095d5a21d3b77e0a70506e017dd48ec1",
  "0x72b526d89d735106ccf3cddfe84fcca7e60f7d1b",
  "0x7a4b52106ea14d25d6c1bd4b96d06d5276a1650b",
  "0x7da692d4af198380d8445fbaf8907b5165015eb8",
  "0x7efdef5da449adf6b597d3863a848dec6c68d874",
  "0x82a1725e96e207e7740c1344a9073e99dfa0820f",
  "0x82f54018990d7cfeb6a85226260b479fa9f58a6a",
  "0x83daf6c184379f4d87525061e3bf768dd1d6ee50",
  "0x8cc462ab3414c53bf3e5eb6218ca160e7af790e0",
  "0x8efabbddfcb9db93a58258adc01e9641fdd4782f",
  "0x8f7e7c4846c3c4f39d8ef41af832a85920e5d42d",
  "0x987de464bde48979ef92592e196cadb926602768",
  "0xa943f12846305a9bba032b34bc90f790006c26e0",
  "0xab980c9b4d538b2101e9434abe39cf978dea601d",
  "0xb213789e819e91c7dab4dd93925e702e7229c74e",
  "0xb65b9492514d8fd0a81361d158d8b3b4522ac935",
  "0xbacdaa25b7785e7fc9814987058c50410e068ae8",
  "0xbba28519b84d95ea5a15887d37b5a45a192e8be4",
  "0xbf993e56a0259300d45cf2385ddb7d12cdfa340f",
  "0xc001380fa25f2a7ad4a32eb5f6164338194287ec",
  "0xc1622ce27de645d79e37370aae4604692b0933a5",
  "0xc250ff0cb3004175fca0e0f32caea34f2c085650",
  "0xc9457f442eefac319659e2e3d6886171a4dfa31f",
  "0xcaa698654fe49717f801ffc6b0513403ffed51c3",
  "0xcf41aeec3ad7e7ccc81f378353ef08f295035c50",
  "0xd9320af2762e711918358422594684756ad760cc",
  "0xda09f229abc7e5caed369e39a96c6de963ce8fa1",
  "0xdafa970bc01cbdf131fa7d5430478f9a5d1e451a",
  "0xdba0678c3d75a28115160300f0a556db77d152f1",
  "0xdc20103d865e239e7d3f68d0c208a0676676149e",
  "0xdd4c368e2778f4a9ff4e9b9caed077a884e6cbb1",
  "0xdf23dac67139ebd3f66fcc4ea224c5c6ae850546",
  "0xe02253f8f47cdbfd88d0b75284c9ddfbab4f6778",
  "0xea113aff7c48f4c5946ed1ef6caa2745acfd1da5",
  "0xf364cbe8a0019c61f03b4cf1180153966fd8f9a2",
  "0xfb2c25803366446fc9ae78244e22226da595d442",
  "0xfcad8c39996f9d81b5d343e59d9112b61faf6fc4",

  "0xc3c389273ea80eb4c9e378f174f0214dba73b5cb", // Test2
  "0x6dcad5b2373963a677d8e0e2d7dcafea192ea41b", // Any Quote ETH Internal Test
  "0x08bdedb48ee01f29dd88e84e6d9296e84d736aa2", // Programmable Fixed Canary
  "0xaa86dd7c149d8220a5a90028620a0e1b2a75f261", // Programmable General Canary
  "0x15fca474b23cafe775120b1fafbcff0e7a827af2", // release canary
  "0xe8b292783382c93706dc43b54bba03f0f1a9908e", // catch trade
  "0x9fa5619b14d3fb6900247db219a3feb657ca46fc", // Tradable
  "0x859e6b4497f977b8ad88fbde2c6ca70c68cec5f9", // TEST launch
  "0x7488b3efd34398bcfe6b48c6a648d7ef6e4127ad", // PSniper Alpha
  "0x5e864e6eabec0f986c9f9f5d5a62e2f2e02a84e3", // PSniper Beta
  "0x1198a419a28cdac1c86d1f14974169c0527b4fa5", // PSniper Epsilon
  "0xb73b85e680f3024de80e8d06cf0e727542991a97", // PSniper Gamma
  "0x4151524125faa09596477776b31351f77459bc90", // PSniper Seven
  "0x59da50c558cb548e8998b77984533f2e9b50f293", // PSniper Final
  "0xede5a16f2835a401aa41a65137efe2ca837b25f2", // PSniper Eleven
  "0x688ec8730893d3254021d356f4dd6c4cf30d5f01", // PSniper Ten
  "0xbc0d6909b8ea31623662e694f276d146a70afa88", // PSniper Twelve
  "0x3daf6a7bd6c95d0eac7e56ab761dc60a7c836f3c", // PSniper Fourteen

  // These addresses are also used by Ethereum test fixtures. Keep this
  // exclusion scoped to Robinhood so the shared visibility contract stays
  // chain-specific.
  "0xf3a6a1edc6f8467c82051b351434bfa79321c070",
  "0x90c453484bc56a625e15eb0e242ca4e23ac74e7c",
  "0xc43074a8a71d9e2d5589de0aff89e6928538eb5e",
  "0x621268e6a4c8252e95412bdc566c061d94280724",
]);

export function isDiscoverableRobinhoodToken(address: string) {
  return !EXPLORE_EXCLUDED_TOKENS.has(address.toLowerCase());
}

// Compatibility for indexed launch readback. Publication visibility is checked
// against the canonical record by the caller; no token address is excluded.
export function isVisibleRobinhoodToken(address: string) {
  return /^0x[\da-f]{40}$/i.test(address);
}

export function isPinnedRobinhoodToken(address: string, chainId: number) {
  return chainId === PINNED_ROBINHOOD_CHAIN_ID && address.toLowerCase() === PINNED_ROBINHOOD_TOKEN;
}
