import { createEvmCustomExploreReaders } from "./evm-custom-explore";
const reader = createEvmCustomExploreReaders(999);
export const readHyperEvmExploreCatalog = reader.readCatalog;
export const readHyperEvmLaunches = reader.readLaunches;
export const readHyperEvmLaunchEvidence = reader.readLaunchEvidence;
export const readHyperEvmToken = reader.readToken;
export type HyperEvmExploreToken = Awaited<ReturnType<typeof readHyperEvmExploreCatalog>>["items"][number];
