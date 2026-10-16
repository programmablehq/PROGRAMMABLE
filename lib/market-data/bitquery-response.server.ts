import "server-only";

export type BitqueryResponseBodyErrorKind =
  | "too-large"
  | "invalid-body"
  | "unavailable";

export class BitqueryResponseBodyError extends Error {
  override name = "BitqueryResponseBodyError";

  constructor(readonly kind: BitqueryResponseBodyErrorKind) {
    super("Bitquery returned an unreadable response body");
  }
}

function cancelResponseBody(response: Response): Promise<void> {
  const body = response.body;
  return body === null || body === undefined
    ? Promise.resolve()
    : body.cancel().catch(() => undefined);
}

function declaredLengthExceedsLimit(
  declaredLength: string,
  maximumBytes: number,
): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)) return true;
  const maximumText = String(maximumBytes);
  return declaredLength.length > maximumText.length ||
    (declaredLength.length === maximumText.length &&
      declaredLength > maximumText);
}

export async function readBoundedBitqueryResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be a positive safe integer");
  }

  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    declaredLengthExceedsLimit(declaredLength, maximumBytes)
  ) {
    await cancelResponseBody(response);
    throw new BitqueryResponseBodyError("too-large");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new BitqueryResponseBodyError("unavailable");

  // Keep one fixed-capacity destination so chunked responses cannot grow an
  // unbounded array of chunks before the limit is checked.
  const bytes = new Uint8Array(maximumBytes);
  let bytesRead = 0;
  let completed = false;
  try {
    while (true) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        throw new BitqueryResponseBodyError("unavailable");
      }
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        throw new BitqueryResponseBodyError("invalid-body");
      }
      if (next.value.byteLength > maximumBytes - bytesRead) {
        throw new BitqueryResponseBodyError("too-large");
      }
      bytes.set(next.value, bytesRead);
      bytesRead += next.value.byteLength;
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, bytesRead),
      );
    } catch {
      throw new BitqueryResponseBodyError("invalid-body");
    }
    completed = true;
    return text;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
