import release from "@/public/openapi/custom-launch-v2.json";

export const dynamic = "force-static";

export function GET() {
  const document = structuredClone(release);
  document.info.version = "2.0.1";
  Object.assign(document.components.schemas.CustomLaunchApiErrorV2.properties.error.properties, {
    retryable: { type: "boolean" },
  });
  return Response.json(document, { headers: { "Access-Control-Allow-Origin": "*" } });
}
