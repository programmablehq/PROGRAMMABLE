import test from "node:test";
import assert from "node:assert/strict";
import { readCompleteFlyReleasesV1 } from "../fly-release-pagination-v1.mjs";
const firstRequest = { query: "query($first: Int!) { releasesUnprocessed(first: $first) {} }", variables: { first: 256 } };
const node = version => ({ id: `release-${version}`, version });
const page = (nodes, totalCount, hasNextPage = false, startCursor = "a", endCursor = "b") => ({
  data: { app: { releasesUnprocessed: { nodes, totalCount,
    pageInfo: { hasNextPage, hasPreviousPage: false, startCursor, endCursor } } } },
});
function readPages(pages, calls = []) {
  return async (request, kind) => {
    calls.push({ request, kind });
    if (!pages.length) throw Error("unexpected page read");
    return { value: structuredClone(pages.shift()), readback: { kind } };
  };
}
test("preserves a complete single response without extra reads", async () => {
  const value = page([node(1)], 1), calls = [];
  const result = await readCompleteFlyReleasesV1({ firstRequest, read: readPages([value], calls) });
  assert.deepEqual(result.value, value); assert.equal(calls.length, 1);
});
test("follows Fly's 250-item server cap and retains every page and confirmation", async () => {
  const first = page(Array.from({ length: 250 }, (_, i) => node(252 - i)), 252, true);
  const calls = [];
  const result = await readCompleteFlyReleasesV1({ firstRequest,
    read: readPages([first, page([node(2), node(1)], 252, false, "c", "d"), first], calls) });
  assert.equal(result.value.data.app.releasesUnprocessed.nodes.length, 252);
  assert.equal(calls[1].request.variables.after, "b");
  assert.match(calls[1].request.query, /after: \$after/u);
  assert.deepEqual(result.observations.map(x => x.readback.kind), ["releases", "release-page:1", "release-confirmation"]);
});
test("rejects missing, duplicate, looping or changing release pages", async () => {
  const first = page([node(3)], 3, true);
  for (const second of [page([node(2)], 3), page([node(3), node(1)], 3, false, "c", "d"),
    page([node(2)], 3, true), page([node(2), node(1)], 4, false, "c", "d")]) {
    await assert.rejects(readCompleteFlyReleasesV1({ firstRequest, read: readPages([first, second]) }), /incomplete/u);
  }
  await assert.rejects(readCompleteFlyReleasesV1({ firstRequest,
    read: readPages([first, page([node(2), node(1)], 3, false, "c", "d"), page([node(4)], 4, true)]) }), /incomplete/u);
});
test("rejects oversized history and an empty next page", async () => {
  await assert.rejects(readCompleteFlyReleasesV1({ firstRequest, read: readPages([page([node(1)], 4097, true)]) }), /incomplete/u);
  await assert.rejects(readCompleteFlyReleasesV1({ firstRequest, read: readPages([page([node(2)], 2, true), page([], 2)]) }), /incomplete/u);
});
test("small pages retain the full bounded history past 32 pages",async()=>{
  const total=1100,calls=[],pages=[];
  for(let offset=0;offset<total;offset+=32){
    pages.push(page(Array.from({length:Math.min(32,total-offset)},(_,index)=>node(total-offset-index)),total,
      offset+32<total,'start-'+offset,'end-'+offset));
  }
  const result=await readCompleteFlyReleasesV1({firstRequest:{...firstRequest,variables:{first:32}},
    read:readPages([...pages,pages[0]],calls)});
  assert.equal(result.value.data.app.releasesUnprocessed.nodes.length,total);
  assert.equal(calls.length,pages.length+1);
});
