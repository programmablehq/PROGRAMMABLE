import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LaunchHistoryMissingState } from "@/components/developer-universal-launch-history";

describe("selected launch history failure", () => {
  it("keeps an unavailable source separate from a successfully read history that lacks the launch", () => {
    const launchId = "10000000-0000-4000-8000-000000000001";
    const unavailable = renderToStaticMarkup(<LaunchHistoryMissingState launchId={launchId} unavailable />);
    expect(unavailable).toContain("Launch data is temporarily unavailable");
    expect(unavailable).toContain("Keep this launch link and refresh");
    expect(unavailable).toContain(launchId);
    expect(unavailable).not.toContain("connect the wallet");
    expect(renderToStaticMarkup(<LaunchHistoryMissingState launchId={launchId} unavailable={false} />)).toContain("The available history does not contain this launch");
  });
});
