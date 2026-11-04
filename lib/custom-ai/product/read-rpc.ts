/** Read-only transport with an optional operation-wide cancellation signal. */
export type ProductReadRpc = (method: string, params: readonly unknown[], signal?: AbortSignal) => Promise<unknown>;
