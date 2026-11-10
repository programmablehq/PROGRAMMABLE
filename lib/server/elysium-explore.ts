import { createEvmCustomExploreReaders } from "./evm-custom-explore";
const reader = createEvmCustomExploreReaders(99901);
export const readElysiumExploreCatalog = reader.readCatalog;
export const readElysiumLaunches = reader.readLaunches;
export const readElysiumLaunchEvidence = reader.readLaunchEvidence;
export const readElysiumToken = reader.readToken;
export type ElysiumExploreToken = Awaited<ReturnType<typeof readElysiumExploreCatalog>>["items"][number];
