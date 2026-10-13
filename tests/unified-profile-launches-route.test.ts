import { beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/unified-explore", () => ({ readUnifiedLaunches: read }));
import { GET } from "@/app/api/profile/launches/route";
const account = `0x${"ab".repeat(20)}`;
beforeEach(() => read.mockReset().mockResolvedValue({ scope: "all", status: "ready", items: [], presentations: [], page: {} }));

it("uses one owner-scoped list and global newest-first pagination for both chains", async () => {
  const response = await GET(new Request(`https://website.invalid/api/profile/launches?account=${account}&page=2`));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ account });
  expect(read).toHaveBeenCalledExactlyOnceWith(2, "", { sort: "newest", mode: "all" }, 10, undefined, account);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it.each(["", "account=nope", `account=${account}&account=${account}`, `account=${account}&chain=1`, `account=${account}&page=0`])("rejects ambiguous or invalid owner queries: %s", async query => {
  expect((await GET(new Request(`https://website.invalid/api/profile/launches?${query}`))).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});
