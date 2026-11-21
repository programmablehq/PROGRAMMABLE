import release from "@/public/openapi/custom-launch-v1.json";

export const dynamic = "force-static";

export function GET() {
  const document = structuredClone(release);
  document.info.version = "1.4.1";
  Object.assign(document.components.schemas.CustomLaunchApiErrorV1.properties.error.properties, {
    retryable: { type: "boolean" },
  });
  return Response.json(document, { headers: { "Access-Control-Allow-Origin": "*" } });
}
