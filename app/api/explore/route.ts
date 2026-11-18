import { NextRequest, NextResponse } from "next/server";

import { tokenDataIndexResetResponse } from
  "../../../lib/server/explore-index-reset";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPLORE_QUERY_PARAMETERS = new Set([
  "chain",
  "limit",
  "model",
  "page",
  "q",
  "rankingCommitment",
  "socials",
  "sort",
]);
const SHA256_COMMITMENT = /^sha256:[0-9a-f]{64}$/u;
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}]/gu;

type ExploreSort =
  | "newest"
  | "oldest"
  | "trending"
  | "market-cap"
  | "market-cap-asc";

function hasCanonicalQueryShape(search: URLSearchParams) {
  const seen = new Set<string>();
  for (const [key] of search) {
    if (!EXPLORE_QUERY_PARAMETERS.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function hasCanonicalPaginationShape(search: URLSearchParams) {
  return ["page", "limit"].every((parameter) => {
    const value = search.get(parameter);
    if (value === null) return true;
    if (!/^[1-9]\d*$/u.test(value)) return false;
    return Number.isSafeInteger(Number(value));
  });
}

function parseExploreSort(value: string | null): ExploreSort {
  if (value === "oldest") return "oldest";
  if (value === "trending") return "trending";
  if (value === "market-cap" || value === "highest-market-cap") {
    return "market-cap";
  }
  if (value === "market-cap-asc" || value === "lowest-market-cap") {
    return "market-cap-asc";
  }
  return "newest";
}

function validSearchQuery(value: string): boolean {
  if (value.length > 1_024) return false;
  const normalized = value.normalize("NFC")
    .replace(INVISIBLE_OR_CONTROL, "")
    .trim()
    .replace(/^\$/u, "")
    .trim()
    .toLowerCase();
  const length = [...normalized].length;
  return length >= 1 && length <= 100;
}

function inputError(body: Record<string, string>) {
  return NextResponse.json(body, {
    status: 400,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (!hasCanonicalQueryShape(search) || !hasCanonicalPaginationShape(search)) {
    return inputError({ error: "Unsupported query parameters" });
  }

  const socials = search.get("socials");
  if (socials !== null && socials !== "yes" && socials !== "no") {
    return inputError({ error: "Unsupported socials filter" });
  }

  const model = search.get("model");
  if (model !== null && model !== "classic" && model !== "custom") {
    return inputError({ error: "Unsupported launch model filter" });
  }

  const query = search.get("q")?.trim() ?? "";
  if (query !== "" && !validSearchQuery(query)) {
    return inputError({ error: "Unsupported search query" });
  }

  const chainValue = search.get("chain");
  const chain = chainValue === null || chainValue === "1"
    ? 1
    : chainValue === "4663"
      ? 4663
      : null;
  if (chain === null) return inputError({ error: "Unsupported chain" });

  const requestedSort = parseExploreSort(search.get("sort"));
  if (chain === 4663 && requestedSort !== "newest") {
    return inputError({
      error: requestedSort === "trending"
        ? "Trending discovery is available on Ethereum only"
        : "Robinhood Explore supports newest sort only",
    });
  }

  const requestedPage = Number(search.get("page") ?? "1");
  const requestedRankingCommitment = search.get("rankingCommitment");
  const ethereumMarketCapSort = chain === 1 &&
    (requestedSort === "market-cap" || requestedSort === "market-cap-asc");
  if (
    (requestedRankingCommitment !== null &&
      (!ethereumMarketCapSort ||
        !SHA256_COMMITMENT.test(requestedRankingCommitment))) ||
    (ethereumMarketCapSort && requestedPage > 1 &&
      requestedRankingCommitment === null)
  ) {
    return inputError({
      error: requestedRankingCommitment === null
        ? "Market-cap pages after page 1 require rankingCommitment"
        : "Unsupported market-cap ranking commitment",
      code: "MARKET_CAP_RANKING_COMMITMENT_REQUIRED",
    });
  }

  const catalog = chain === 4663 ? "/api/explore/robinhood" : "/api/explore/ethereum";
  const term = query.normalize("NFC").replace(INVISIBLE_OR_CONTROL, "").trim().replace(/^\$/u, "").trim();
  return tokenDataIndexResetResponse(term && term.length <= 128 ? `${catalog}?${new URLSearchParams({ q: term })}` : catalog);
}
