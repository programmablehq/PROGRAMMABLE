import { isDeepStrictEqual } from "node:util";

export const MAX_FLY_RELEASES_V1 = 4096;
export const MAX_FLY_RELEASE_READBACKS_V1 = 129;
const fail = () => { throw new TypeError("Fly release inventory is paginated or incomplete"); };
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
function connection(value) {
  if (!exact(value, ["data"]) || !exact(value.data, ["app"])
    || !exact(value.data.app, ["releasesUnprocessed"])) fail();
  const row = value.data.app.releasesUnprocessed;
  if (!exact(row, ["totalCount", "pageInfo", "nodes"])
    || !Number.isSafeInteger(row.totalCount) || row.totalCount < 1 || row.totalCount > MAX_FLY_RELEASES_V1
    || !Array.isArray(row.nodes) || row.nodes.length < 1 || row.nodes.length > 256
    || !exact(row.pageInfo, ["hasNextPage", "hasPreviousPage", "startCursor", "endCursor"])) fail();
  const page = row.pageInfo;
  if (typeof page.hasNextPage !== "boolean" || typeof page.hasPreviousPage !== "boolean"
    || [page.startCursor, page.endCursor].some(cursor => typeof cursor !== "string" || !cursor || cursor.length > 2048)) fail();
  return row;
}

// The same request sequence validates stored raw readbacks and drives fresh
// network reads. The assembled inventory is never represented as a raw response.
function* releaseInventory(firstRequest) {
  const maximumPages=firstRequest.variables?.first===32?128:32;
  const first = yield { request: firstRequest, kind: "releases" };
  const start = connection(first.value);
  if (start.pageInfo.hasPreviousPage) fail();
  if (!start.pageInfo.hasNextPage && start.totalCount === start.nodes.length) return { value: first.value, observations: [first] };
  const observations = [first], nodes = [], ids = new Set(), versions = new Set(), cursors = new Set();
  let page = start;
  for (let index = 0; ; index++) {
    if (index >= maximumPages || page.totalCount !== start.totalCount || cursors.has(page.pageInfo.endCursor)) fail();
    cursors.add(page.pageInfo.endCursor);
    for (const node of page.nodes) {
      if (typeof node?.id !== "string" || !node.id || !Number.isSafeInteger(node.version) || node.version < 1
        || ids.has(node.id) || versions.has(node.version)) fail();
      ids.add(node.id); versions.add(node.version); nodes.push(node);
    }
    if (nodes.length > start.totalCount) fail();
    if (!page.pageInfo.hasNextPage) {
      if (nodes.length !== start.totalCount) fail();
      break;
    }
    if (nodes.length >= start.totalCount || index === maximumPages - 1) fail();
    const query = firstRequest.query.replace("$first: Int!", "$first: Int!, $after: String!")
      .replace("releasesUnprocessed(first: $first)", "releasesUnprocessed(first: $first, after: $after)");
    if (query === firstRequest.query || !query.includes("after: $after")) fail();
    const next = yield { request: { query, variables: { ...firstRequest.variables, after: page.pageInfo.endCursor } },
      kind: `release-page:${index + 1}` };
    observations.push(next); page = connection(next.value);
  }
  if (observations.length === 1) return { value: first.value, observations };
  const confirmation = yield { request: firstRequest, kind: "release-confirmation" };
  connection(confirmation.value);
  if (!isDeepStrictEqual(confirmation.value, first.value)) fail();
  observations.push(confirmation);
  return { observations, value: { data: { app: { releasesUnprocessed: {
    totalCount: start.totalCount, nodes,
    pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: start.pageInfo.startCursor, endCursor: page.pageInfo.endCursor },
  } } } } };
}

export async function readCompleteFlyReleasesV1({ firstRequest, read }) {
  const inventory = releaseInventory(firstRequest);
  let next = inventory.next();
  while (!next.done) next = inventory.next(await read(next.value.request, next.value.kind));
  return next.value;
}

export function validateCompleteFlyReleasesV1({ firstRequest, read }) {
  const inventory = releaseInventory(firstRequest);
  let next = inventory.next();
  while (!next.done) next = inventory.next(read(next.value.request, next.value.kind));
  return next.value;
}
