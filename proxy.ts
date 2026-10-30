import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { negotiatePageRepresentation } from "@/lib/content-negotiation";
import { buildProgrammableHomeMarkdown } from "@/lib/developer-docs-content";

function isRetiredPredictionApi(pathname: string): boolean {
  return pathname === "/api/prediction" ||
    pathname.startsWith("/api/prediction/");
}

function retiredPredictionApiResponse(): NextResponse {
  return NextResponse.json(
    {
      schemaVersion: "programmable.api-error.v1",
      status: "error",
      error: {
        code: "api_route_not_found",
        message: "No public Programmable API route matches this path.",
      },
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

function withAcceptVariation(response: NextResponse): NextResponse {
  const values = new Set(
    (response.headers.get("Vary") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  values.add("Accept");
  response.headers.set("Vary", [...values].join(", "));
  return response;
}

function homeMarkdownResponse(): NextResponse {
  return new NextResponse(buildProgrammableHomeMarkdown(), {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "text/markdown; charset=utf-8",
      Link: '<https://programmable.market/>; rel="canonical"; type="text/html"',
      Vary: "Accept",
    },
  });
}

export function proxy(request: NextRequest) {
  // Keep the conventional uppercase entry on the canonical public guide.
  // Check the actual pathname because matchers can be case insensitive.
  if (request.nextUrl.pathname.toLowerCase() === "/agents.md") {
    if (
      request.nextUrl.pathname !== "/agents.md" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const destination = request.nextUrl.clone();
      destination.pathname = "/agents.md";
      return NextResponse.redirect(destination, 308);
    }
    return NextResponse.next();
  }
  if (isRetiredPredictionApi(request.nextUrl.pathname)) {
    return retiredPredictionApiResponse();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return withAcceptVariation(NextResponse.next());
  }

  const representation = negotiatePageRepresentation(
    request.headers.get("Accept"),
  );
  if (representation === "not-acceptable") {
    return new NextResponse(
      "Not acceptable. Request text/html or text/markdown.",
      {
        status: 406,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
          Vary: "Accept",
        },
      },
    );
  }
  if (representation === "markdown") {
    if (request.nextUrl.pathname === "/") {
      return homeMarkdownResponse();
    }
  }
  return withAcceptVariation(NextResponse.next());
}

export const config = {
  matcher: ["/", "/AGENTS.md", "/api/prediction/:path*"],
};
