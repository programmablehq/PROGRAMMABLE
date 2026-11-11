import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { atomicCreate, atomicWrite } from "../src/io.mjs";

async function directory(t) {
  const root = await mkdtemp(path.join(tmpdir(), "programmable-launch-io-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("pack output and its receipt both complete on the native filesystem", async (t) => {
  const root = await directory(t);
  const launch = path.join(root, "nested", "launch.json");
  const receipt = `${launch}.receipt.json`;
  await atomicWrite(launch, '{"nonce":"first"}\n');
  await atomicWrite(receipt, '{"requestSha256":"first"}\n');
  await atomicWrite(launch, '{"nonce":"second"}\n');
  assert.equal(await readFile(launch, "utf8"), '{"nonce":"second"}\n');
  assert.equal(await readFile(receipt, "utf8"), '{"requestSha256":"first"}\n');
  assert.deepEqual((await readdir(path.dirname(launch))).sort(), ["launch.json", "launch.json.receipt.json"]);
});

test("exclusive state creation does not overwrite an existing journal", async (t) => {
  const root = await directory(t);
  const journal = path.join(root, "state.json");
  await atomicCreate(journal, '{"state":"pending"}\n');
  await assert.rejects(atomicCreate(journal, '{"state":"replaced"}\n'), { code: "EEXIST" });
  assert.equal(await readFile(journal, "utf8"), '{"state":"pending"}\n');
  assert.deepEqual(await readdir(root), ["state.json"]);
});

test("publication failures still reject and remove temporary files", async (t) => {
  const root = await directory(t);
  const destination = path.join(root, "occupied");
  await mkdir(destination);
  await assert.rejects(atomicWrite(destination, "must not succeed"));
  assert.deepEqual(await readdir(root), ["occupied"]);
  assert.deepEqual(await readdir(destination), []);
});
