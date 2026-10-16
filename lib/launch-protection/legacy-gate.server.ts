import "server-only";
import { NextResponse } from "next/server";

/** Legacy factories cannot add immutable token protection after deployment. */
export function legacyLaunchGuardV1(env: Readonly<Record<string, string | undefined>> = process.env): NextResponse | null {
  const mode = env.PROGRAMMABLE_LAUNCH_PROTECTION_V1_MODE;
  if (mode === "candidate" || (mode === undefined && env.NODE_ENV !== "production")) return null;
  // Unknown modes also fail closed. Only a protected replacement can restore creation in required mode.
  return NextResponse.json({ code: "LAUNCH_PROTECTION_REQUIRED", available: false,
    error: "This legacy launch route is paused. Use the protected Custom Launch API package." },
  { status: 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
