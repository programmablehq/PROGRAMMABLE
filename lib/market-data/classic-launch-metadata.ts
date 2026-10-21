import { MAX_TOKEN_SYMBOL_BYTES, utf8ByteLength } from "../metadata-policy";

/** Classic contracts bounded UTF-8 bytes, without the newer uppercase input rule. */
export function isValidClassicDisplaySymbol(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    && utf8ByteLength(value) <= MAX_TOKEN_SYMBOL_BYTES
    && !/[\p{Cc}\p{Cf}]/u.test(value);
}
