import type { CoinSetup } from "./coin-setup";
import type { ChatMessage, Draft } from "./types";

export type ImageReceipt = { id: string; url: string; hash: string };
export type StudioState = { settings: CoinSetup; messages: ChatMessage[]; input?: string; editTarget?: import("./design-edits").EditTarget; draftId?: string; contextId?: string; pendingChange?: string; image?: ImageReceipt };
export type StoredStudio = { revision: number; state: StudioState; activeRequest?: import("./types").ChatRequest; draft?: Draft; intent?: import("./launch-intent").LaunchIntent };
export type DraftVersion = { id:string; createdAt:string; name:string; summary:string; sourceHash:string; draftId:string };
