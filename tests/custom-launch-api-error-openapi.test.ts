import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { expect, it } from "vitest";
import { GET as getV1 } from "../app/openapi/custom-launch-v1.4.1.json/route";
import { GET as getV2 } from "../app/openapi/custom-launch-v2.0.1.json/route";
import { programmablePublicOpenApi } from "../lib/public-openapi";
import releaseV1 from "../public/openapi/custom-launch-v1.json";
import releaseV2 from "../public/openapi/custom-launch-v2.json";

it("serves the compatibility documents with only the error and documentation revision amended", async () => {
  for (const [get, original, name, version] of [
    [getV1, releaseV1, "CustomLaunchApiErrorV1", "1.4.1"],
    [getV2, releaseV2, "CustomLaunchApiErrorV2", "2.0.1"],
  ] as const) {
    const doc = await get().json();
    expect(doc.info.version).toBe(version);
    const fields = doc.components.schemas[name].properties.error.properties;
    expect(fields.retryable).toEqual({ type: "boolean" });
    delete fields.retryable;
    doc.info.version = original.info.version;
    expect(doc).toEqual(original);
  }
});

it("decodes both API error variants and keeps unknown or mistyped fields invalid", async () => {
  const ajv = addFormats(new Ajv2020());
  const v1 = await getV1().json();
  const v2 = await getV2().json();
  const error = {
    code: "UNAUTHENTICATED",
    message: "A valid API key is required",
    requestId: "ab29999f-4675-4891-a353-5304309115f3",
  };
  for (const schema of [
    v1.components.schemas.CustomLaunchApiErrorV1,
    v2.components.schemas.CustomLaunchApiErrorV2,
    programmablePublicOpenApi.components.schemas.CustomLaunchApiError,
  ]) {
    const validate = ajv.compile(schema);
    const accepts = (fields: object) => validate({ schemaVersion: "programmable.api-error.v1", error: { ...error, ...fields } });
    expect(accepts({})).toBe(true);
    expect(accepts({ retryable: false })).toBe(true);
    expect(accepts({ retryable: true })).toBe(true);
    expect(accepts({ retryable: "false" })).toBe(false);
    expect(accepts({ unknown: true })).toBe(false);
  }
});
