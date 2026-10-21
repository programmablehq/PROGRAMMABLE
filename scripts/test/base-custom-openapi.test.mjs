import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = path.join(root, "public/openapi");
const base = "https://programmable.market/openapi/base-custom-launch-v1.json";
const document = JSON.parse(fs.readFileSync(path.join(directory, "base-custom-launch-v1.json")));
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/base-finalized-custom-launch-metadata-feed-v1.json")));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false,
  loadSchema: async uri => JSON.parse(fs.readFileSync(path.join(directory, path.basename(new URL(uri).pathname)))),
});
ajv.addSchema(document, base);
const schema = document.paths["/v4/chains/8453/finalized-custom-launches"].get.responses["200"].content["application/json"].schema;
const validate = await ajv.compileAsync({ $ref: base + schema.$ref });

test("the Base OpenAPI validates the actual public finalized feed", () => {
  assert.ok(validate(fixture), JSON.stringify(validate.errors));
  execFileSync(process.execPath, ["scripts/generate-base-custom-openapi.mjs", "--check"], { cwd: root });
});

test("the Base contract rejects substituted chains, checkpoint schemas and fee policies", () => {
  for (const change of [
    row => { row.chainId = "1"; },
    row => { row.finality.finalizedCheckpoint.schemaVersion = "programmable.ethereum-finalized-checkpoint-quorum.v1"; },
    row => { row.routingFeePolicy.policy.rateBps = 100; },
    row => { row.routingFeePolicy.policy.defaultCollection.recipient = "0x" + "11".repeat(20); },
    row => { row.routingFeePolicy.enforcementBoundary.chainId = "1"; },
    row => { row.routingFeePolicy.policyHash = "sha256:" + "11".repeat(32); },
  ]) {
    const page = structuredClone(fixture);
    change(page.launches[0]);
    assert.equal(validate(page), false);
  }
});
