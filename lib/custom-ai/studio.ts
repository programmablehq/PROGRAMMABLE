import type { CoinSetup } from "./coin-setup";
import type { ChatMessage, Draft } from "./types";

export type ImageReceipt = { id: string; url: string; hash: string };
export type StudioState = { settings: CoinSetup; messages: ChatMessage[]; draftId?: string; image?: ImageReceipt };
export type StoredStudio = { revision: number; state: StudioState; draft?: Draft };
