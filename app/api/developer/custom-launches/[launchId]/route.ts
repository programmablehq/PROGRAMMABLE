import { getProductionDeveloperLaunchHistoryBridgeV1 } from
  "@/lib/server/custom-launch/launch-history-bridge-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

type RouteContext = Readonly<{
  params: Promise<Readonly<{ launchId: string }>>;
}>;

export async function GET(request: Request, context: RouteContext) {
  const { launchId } = await context.params;
  return getProductionDeveloperLaunchHistoryBridgeV1().get(request, launchId);
}
