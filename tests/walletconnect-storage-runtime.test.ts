import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("retains the verified upstream WalletConnect storage bytes and its runtime imports", () => {
  const directory = "packages/walletconnect-storage-runtime";
  const source = join(directory, "upstream");
  const files = readdirSync(source, { recursive: true, encoding: "utf8" })
    .filter(file => statSync(join(source, file)).isFile()).sort();
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file).update("\0").update(readFileSync(join(source, file))).update("\0");
  }
  expect(digest.digest("hex")).toBe("bf3aeab241db58c73be8c776b08b36828caed4aa81b690d717592435cc4c1c0d");
  const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  expect(Object.keys(metadata.dependencies)).toEqual(["destr"]);
  expect(Object.keys(metadata.exports)).toEqual([".", "./drivers/fs-lite"]);
});
