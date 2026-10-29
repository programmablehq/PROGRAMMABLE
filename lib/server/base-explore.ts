import { createEvmCustomExploreReaders } from "./evm-custom-explore";
const reader = createEvmCustomExploreReaders(8453);
export const readBaseExploreCatalog = reader.readCatalog;
export const readBaseLaunches = reader.readLaunches;
export const readBaseLaunchEvidence = reader.readLaunchEvidence;
export const readBaseToken = reader.readToken;
export type BaseExploreToken = Awaited<ReturnType<typeof readBaseExploreCatalog>>["items"][number];
