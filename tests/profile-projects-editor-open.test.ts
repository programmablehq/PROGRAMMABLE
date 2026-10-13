import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as profileProjects from "../components/profile-projects";
import type {
  CreatorProjectMarketCapV1,
  CreatorProjectSummaryV1,
} from "../components/profile-projects";
import type { ClassicV3Reward } from "../lib/profile/classic-v3-rewards";

const project = {
  chainId: 1 as const,
  tokenAddress: "0x3333333333333333333333333333333333333333" as const,
  name: "Project",
  symbol: "PROJECT",
  imageUrl: null,
  source: "envio-classic-v3" as const,
  article: null,
};

const rewardOwner = "0x1111111111111111111111111111111111111111" as const;
const rewardVault = "0x2222222222222222222222222222222222222222" as const;
const reward = {
  releaseVersion: "classic-v4",
  tokenAddress: project.tokenAddress,
  tokenName: project.name,
  tokenSymbol: project.symbol,
  poolId: `0x${"4".repeat(64)}`,
  vaultAddress: rewardVault,
  beneficiary: rewardOwner,
  payoutAddress: rewardOwner,
  shareBps: 10_000,
  ownedAllocations: [{
    allocationIndex: 0,
    beneficiary: rewardOwner,
    payoutAddress: rewardOwner,
    shareBps: 10_000,
  }],
  claimableWei: "0",
  claimableEth: "0",
  claimedWei: "0",
  claimedEth: "0",
  buySwapFeeBps: 10,
  sellSwapFeeBps: 10,
  platformFeeBps: 10,
  beneficiaries: [{
    allocationIndex: 0,
    beneficiary: rewardOwner,
    payoutAddress: rewardOwner,
    shareBps: 10_000,
  }],
  launchTransactionHash: `0x${"5".repeat(64)}`,
} satisfies ClassicV3Reward;

describe("My projects editor opening", () => {
  it("offers reward receiver changes only to the verified current owner", () => {
    const manageable = profileProjects.manageableClassicRewardsByTokenV1(
      [reward],
      rewardOwner,
    );

    expect(manageable.get(project.tokenAddress.toLowerCase())).toBe(reward);
    expect(profileProjects.manageableClassicRewardsByTokenV1(
      [reward],
      "0x9999999999999999999999999999999999999999",
    ).size).toBe(0);
    expect(profileProjects.manageableClassicRewardsByTokenV1(
      [{ ...reward, ownedAllocations: [] }],
      rewardOwner,
    ).size).toBe(0);
  });

  it("fails closed when two reward identities claim the same token", () => {
    expect(profileProjects.manageableClassicRewardsByTokenV1(
      [reward, { ...reward, vaultAddress: project.tokenAddress }],
      rewardOwner,
    ).size).toBe(0);
  });

  it("validates a new, non-zero reward receiver", () => {
    expect(profileProjects.rewardReceiverAddressErrorV1("nope", rewardOwner))
      .toBe("Enter a valid Ethereum address.");
    expect(profileProjects.rewardReceiverAddressErrorV1(
      "0x0000000000000000000000000000000000000000",
      rewardOwner,
    )).toBe("Enter a valid Ethereum address.");
    expect(profileProjects.rewardReceiverAddressErrorV1(
      rewardOwner.toUpperCase().replace("0X", "0x"),
      rewardOwner,
    )).toBe("Enter a different reward receiver.");
    expect(profileProjects.rewardReceiverAddressErrorV1(
      "0x9999999999999999999999999999999999999999",
      rewardOwner,
    )).toBe("");
  });

  it("wires an accessible reward receiver dialog into each eligible launch", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );
    const viewSource = readFileSync(
      join(process.cwd(), "components/profile-view.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(process.cwd(), "components/profile-projects.module.css"),
      "utf8",
    );

    expect(source).toContain("Change reward receiver");
    expect(source).toContain("if (!dialog.open) dialog.showModal()");
    expect(source).toContain("htmlFor={fieldId}");
    expect(source).toContain("aria-invalid={fieldError ? true : undefined}");
    expect(source).toContain("Future creator fees for this allocation");
    expect(viewSource).toContain("onChangeRewardReceiver={(reward, newReceiver, allocationIndex)");
    expect(viewSource).toContain("rewardReceiverActionKeyV1(reward.vaultAddress)");
    const receiverAction = source.indexOf(
      "{canChangeRewardReceiver && manageableReward ? (",
    );
    const articleAction = source.indexOf(
      "<span className={styles.articleActionSlot}>",
    );
    const tokenAction = source.indexOf(
      "className={styles.viewTokenAction}",
    );
    expect(source).toContain(
      'href={`/token/${project.tokenAddress}?chain=${project.chainId}`}',
    );
    expect(receiverAction).toBeGreaterThan(-1);
    expect(articleAction).toBeGreaterThan(receiverAction);
    expect(tokenAction).toBeGreaterThan(articleAction);
    expect(styles).toContain('grid-template-areas: "receiver article token"');
    expect(styles).toMatch(
      /grid-template-areas:\s*"receiver receiver"\s*"article token"/u,
    );
    expect(styles).toMatch(
      /\.actions button,\s*\.actions a\s*\{[^}]*background:\s*transparent;[^}]*border-color:/su,
    );
    expect(styles).not.toMatch(
      /\.actions button\s*\{[^}]*background:\s*var\(--brand-ivory/u,
    );
  });

  it("preloads the editor only after explicit user intent", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );

    expect(source).not.toContain("preloadCreatorArticlePageV1");
    expect(source).not.toContain(
      "if (nextProjects.length > 0) preloadCreatorArticleEditorModule()",
    );
    expect(source).toContain("onPointerEnter={() => warmEditor(project)}");
    expect(source).toContain("onPointerDown={() => warmEditor(project)}");
    expect(source).toContain("onFocus={() => warmEditor(project)}");
  });

  it("remounts authenticated projects when the connected wallet changes", () => {
    const projectsSource = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );

    expect(readFileSync(join(process.cwd(), "components/robinhood-launches-view.tsx"), "utf8")).toContain(
      'key={props.account.toLowerCase()}',
    );
    expect(projectsSource).toContain(
      "const [projectPage, setProjectPage] = useState(1);",
    );
  });

  it("withholds project permissions across owners but preserves a same-owner refresh", () => {
    const firstOwner = "0x1111111111111111111111111111111111111111";
    const secondOwner = "0x2222222222222222222222222222222222222222";
    const ready = {
      ownerAccount: firstOwner,
      phase: "ready" as const,
      projects: [project],
    };

    expect(profileProjects.scopeCreatorProjectOwnerStateV1(ready, firstOwner))
      .toBe(ready);
    expect(profileProjects.scopeCreatorProjectOwnerStateV1(ready, secondOwner))
      .toBeNull();
    expect(profileProjects.scopeCreatorProjectOwnerStateV1(ready, null))
      .toBeNull();
    expect(profileProjects.beginCreatorProjectOwnerRefreshV1(ready, firstOwner))
      .toEqual({ ...ready, phase: "loading" });
    expect(profileProjects.beginCreatorProjectOwnerRefreshV1(ready, secondOwner))
      .toEqual({ ownerAccount: secondOwner, phase: "loading", projects: [] });

    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );
    expect(source).toContain(
      "const projects = scopedProjectOwnerState?.projects ?? emptyCreatorProjectsV1;",
    );
    expect(source).toContain(
      "const key = `${walletAccount}:${project.tokenAddress.toLowerCase()}`;",
    );
  });

  it("keeps the article action slot stable without granting unverified access", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );

    expect(source).toContain("const canEditArticle = editableTokens.has(");
    expect(source).toContain("{canEditArticle ? (");
    expect(source).toContain("className={styles.articleActionSlot}");
    expect(source).toContain("className={styles.articleSummarySlot}");
    expect(source).toContain('phase === "loading"');
    expect(source).toContain(': "Unavailable"}');
    expect(source).not.toMatch(
      /className=\{styles\.articleActionState\}[\s\S]{0,120}aria-hidden/u,
    );
    expect(source).toContain(
      "Launch details could not be refreshed. The current list is still shown.",
    );
    const styles = readFileSync(
      join(process.cwd(), "components/profile-projects.module.css"),
      "utf8",
    );
    expect(styles).toMatch(
      /\.articleSummarySlot\s*\{[^}]*min-height:\s*1\.3em;/s,
    );
    expect(styles).toMatch(
      /\.articleActionSlot\s*\{[^}]*min-height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /\.articleActionSlot\s*>\s*\*\s*\{[^}]*width:\s*100%;/s,
    );
  });

  it("uses a native modal while the article editor opens and restores focus", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(process.cwd(), "components/profile-projects.module.css"),
      "utf8",
    );

    expect(source).toContain("const dialogRef = useRef<HTMLDialogElement>(null)");
    expect(source).toContain("if (!dialog.open) dialog.showModal()");
    expect(source).toContain("previouslyFocused?.focus({ preventScroll: true })");
    expect(source).toContain("onCancel={(event) => {");
    expect(source).not.toContain('className={styles.openingDialog}\n        role="dialog"');
    expect(styles).toContain(".openingBackdrop::backdrop");
  });

  it("communicates refresh progress without relying on motion", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(process.cwd(), "components/profile-projects.module.css"),
      "utf8",
    );

    expect(source).toContain("aria-busy={refreshInProgress}");
    expect(source).toContain('? "Refreshing…" : "Refresh"');
    expect(source).toContain("data-loading={refreshInProgress}");
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.refresh\[data-loading="true"\] \.refreshIcon/u,
    );
    expect(styles).toMatch(
      /\.loading,\s*\.empty,\s*\.error\s*\{[^}]*font-size:\s*13px;/s,
    );
  });

  it("returns a stalled launch refresh to an actionable error state", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );

    expect(source).toContain("creatorProjectRefreshTimeoutMs = 12_000");
    expect(source).toContain(
      "controller.abort(creatorProjectRefreshTimeoutReason)",
    );
    expect(source).toContain("loadCreatorProjectListV1({");
    expect(source).toContain("const authHeaders = await input.getAuthHeaders()");
    expect(source).toContain("Promise.race([");
    expect(source).toContain(
      "Launch refresh took too long. Select Refresh to try again.",
    );
    expect(source).toContain("onRefresh={refreshProjects}");
    expect(source).toContain("onClick={onRefresh}");
  });

  it("bounds a stalled authentication read before the network request starts", async () => {
    let fetched = false;
    await expect(profileProjects.loadCreatorProjectListV1({
      fetchImpl: (async () => {
        fetched = true;
        throw new Error("fetch must not start");
      }) as typeof fetch,
      getAuthHeaders: () => new Promise<Record<string, string>>(() => undefined),
      timeoutMs: 5,
    })).rejects.toThrow("creator-project-refresh-timeout");
    expect(fetched).toBe(false);
  });

  it("keeps the launch refresh busy until local and profile reads settle", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );
    const profileSource = readFileSync(
      join(process.cwd(), "components/profile-view.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'const refreshInProgress = phase === "loading" || refreshing;',
    );
    expect(source).toContain('phase === "ready" ? "Launches updated"');
    expect(profileSource).toContain("refreshing={profileRefreshing}");
  });

  it("uses one unknown launch placeholder while keeping warm launch actions visible", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(process.cwd(), "components/profile-projects.module.css"),
      "utf8",
    );

    expect(source).not.toContain(
      "Array.from({ length: creatorProjectPageSize }, (_, item)",
    );
    expect(styles).toContain("--project-list-min-height: var(--project-row-min-height)");
    expect(styles).toMatch(
      /\.skeletonList\s*\{[^}]*min-height:\s*var\(--project-list-min-height\);/s,
    );
    expect(styles).toMatch(
      /\.list\s*\{[^}]*min-height:\s*var\(--project-list-min-height\);/s,
    );
    expect(styles).toMatch(
      /\.project\s*\{[^}]*min-height:\s*var\(--project-row-min-height\);/s,
    );
    expect(styles).toMatch(
      /\.skeletonProject\s*\{[^}]*min-height:\s*var\(--project-row-min-height\);/s,
    );
    expect(source).toContain(
      'phase === "loading" && visibleProjects.length === 0',
    );
    expect(source).toContain("{canEditArticle ? (");
  });

  it("paginates verified projects by highest available market cap", () => {
    const paginate = (profileProjects as unknown as {
      paginateCreatorProjectsV1(
        projects: readonly CreatorProjectSummaryV1[],
        marketCaps: readonly CreatorProjectMarketCapV1[],
        requestedPage: number,
      ): Readonly<{
        currentPage: number;
        totalPages: number;
        items: readonly CreatorProjectSummaryV1[];
      }>;
    }).paginateCreatorProjectsV1;
    expect(typeof paginate).toBe("function");

    const projects = Array.from({ length: 7 }, (_, index) => ({
      ...project,
      tokenAddress: `0x${String(index + 1).padStart(40, "0")}` as `0x${string}`,
      name: `Project ${index + 1}`,
    }));
    const marketCaps = [100, 700, 300, 600, 200, 500, 400].map((value, index) => ({
      tokenAddress: projects[index].tokenAddress,
      usdWad: String(BigInt(value) * 10n ** 18n),
      ethWei: null,
      label: `$${value}`,
    }));

    expect(paginate(projects, marketCaps, 1)).toMatchObject({
      currentPage: 1,
      totalPages: 2,
      items: [projects[1], projects[3], projects[5], projects[6], projects[2]],
    });
    expect(paginate(projects, marketCaps, 99)).toMatchObject({
      currentPage: 2,
      totalPages: 2,
      items: [projects[4], projects[0]],
    });
  });

  it("preserves a page-two edit action across refresh and clamps after shrink", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );
    const paginate = (profileProjects as unknown as {
      paginateCreatorProjectsV1(
        projects: readonly CreatorProjectSummaryV1[],
        marketCaps: readonly CreatorProjectMarketCapV1[],
        requestedPage: number,
      ): Readonly<{
        currentPage: number;
        totalPages: number;
        items: readonly CreatorProjectSummaryV1[];
      }>;
    }).paginateCreatorProjectsV1;
    const editableProject = {
      ...project,
      tokenAddress: "0x9999999999999999999999999999999999999999" as const,
      name: "Programmable",
      symbol: "V4",
      article: {
        revision: 3,
        title: "Shape what assets can do",
        updatedAt: "2026-08-21T23:55:55.976Z",
      },
    };
    const projects = [
      ...Array.from({ length: 5 }, (_, index) => ({
        ...project,
        tokenAddress: `0x${String(index + 1).padStart(40, "0")}` as `0x${string}`,
        name: `A Project 0${index + 1}`,
      })),
      editableProject,
      ...Array.from({ length: 5 }, (_, index) => ({
        ...project,
        tokenAddress: `0x${String(index + 11).padStart(40, "0")}` as `0x${string}`,
        name: `Z Project ${index + 11}`,
      })),
    ];

    const pageTwo = paginate(projects, [], 2);
    const refreshedPageTwo = paginate([...projects], [], pageTwo.currentPage);
    const editableTokens = new Set([editableProject.tokenAddress.toLowerCase()]);

    expect(source).not.toContain("setProjectPage(1);");
    expect(source).toContain(
      ': project.article ? "Edit article" : "Create article"',
    );
    expect(pageTwo).toMatchObject({
      currentPage: 2,
      totalPages: 3,
    });
    expect(refreshedPageTwo.items[0]).toEqual(editableProject);
    expect(
      editableTokens.has(refreshedPageTwo.items[0].tokenAddress.toLowerCase()),
    ).toBe(true);
    expect(refreshedPageTwo.items[0].article).not.toBeNull();

    expect(paginate(projects.slice(0, 7), [], 3)).toMatchObject({
      currentPage: 2,
      totalPages: 2,
    });
  });

  it("keeps verified wallet launches visible and lets authenticated data override them", () => {
    const merge = (profileProjects as unknown as {
      mergeCreatorWalletProjectsV1(
        walletProjects: readonly CreatorProjectSummaryV1[],
        authenticatedProjects: readonly CreatorProjectSummaryV1[],
      ): readonly CreatorProjectSummaryV1[];
    }).mergeCreatorWalletProjectsV1;
    const article = {
      revision: 2,
      title: "Updated project",
      updatedAt: "2026-08-23T00:00:00.000Z",
    };

    expect(merge([project], [])).toEqual([project]);
    expect(merge([project], [{ ...project, article }])).toEqual([
      { ...project, article },
    ]);
  });

  it("keeps launch cards focused on identity, market cap, and actions", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );
    const viewSource = readFileSync(
      join(process.cwd(), "components/profile-view.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(process.cwd(), "components/profile-projects.module.css"),
      "utf8",
    );

    expect(source).not.toContain("CreatorProjectInitialBuyV1");
    expect(source).not.toContain("formatCreatorProjectInitialBuyV1");
    expect(source).not.toContain("Initial buy ");
    expect(source).toContain("Market cap ");
    expect(source).toContain("project.partnerAttribution");
    expect(source).toContain("project.article");
    expect(viewSource).not.toContain("creatorProjectInitialBuys");
    expect(viewSource).not.toContain("initialBuys={");
    expect(styles).not.toContain(".initialBuy");
  });

  it("refreshes the Privy identity before reading the bound access token", async () => {
    const acquire = (profileProjects as unknown as {
      acquireCreatorArticleAuthHeadersV1(input: Readonly<{
        getAccessToken: () => Promise<string | null>;
        getIdentityToken: () => Promise<string | null>;
      }>): Promise<Record<string, string>>;
    }).acquireCreatorArticleAuthHeadersV1;
    expect(typeof acquire).toBe("function");

    let identityCurrent = false;
    const events: string[] = [];
    await expect(acquire({
      getIdentityToken: async () => {
        events.push("identity");
        identityCurrent = true;
        return "identity-token";
      },
      getAccessToken: async () => {
        events.push("access");
        return identityCurrent ? "access-token" : null;
      },
    })).resolves.toEqual({
      Authorization: "Bearer access-token",
      "X-Privy-Identity-Token": "identity-token",
    });
    expect(events).toEqual(["identity", "access"]);
  });

  it("uses the verified access token when Privy omits an identity token", async () => {
    const acquire = (profileProjects as unknown as {
      acquireCreatorArticleAuthHeadersV1(input: Readonly<{
        getAccessToken: () => Promise<string | null>;
        getIdentityToken: () => Promise<string | null>;
      }>): Promise<Record<string, string>>;
    }).acquireCreatorArticleAuthHeadersV1;

    await expect(acquire({
      getIdentityToken: async () => null,
      getAccessToken: async () => "access-token",
    })).resolves.toEqual({ Authorization: "Bearer access-token" });
  });

  it("turns an API failure into a user-readable rejected action", async () => {
    const load = (profileProjects as unknown as {
      loadCreatorArticleEditorV1(
        candidate: typeof project,
        getAuthHeaders: () => Promise<Record<string, string>>,
        request: typeof fetch,
      ): Promise<unknown>;
    }).loadCreatorArticleEditorV1;
    expect(typeof load).toBe("function");
    await expect(load(
      project,
      async () => ({ Authorization: "Bearer token", "X-Privy-Identity-Token": "identity" }),
      async () => new Response(JSON.stringify({ code: "creator_article_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    )).rejects.toThrow("Creator article unavailable");
  });

  it("returns the verified article and its exact ETag", async () => {
    const load = (profileProjects as unknown as {
      loadCreatorArticleEditorV1(
        candidate: typeof project,
        getAuthHeaders: () => Promise<Record<string, string>>,
        request: typeof fetch,
      ): Promise<{ article: unknown; etag: string | null }>;
    }).loadCreatorArticleEditorV1;
    expect(typeof load).toBe("function");
    const article = {
      schemaVersion: "programmable.creator-article.v1",
      chainId: 1,
      tokenAddress: project.tokenAddress,
      revision: 1,
      status: "published",
      title: "Project story",
      bannerImage: null,
      document: { type: "doc", content: [{ type: "paragraph" }] },
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    };
    await expect(load(
      project,
      async () => ({ Authorization: "Bearer token", "X-Privy-Identity-Token": "identity" }),
      async () => new Response(JSON.stringify({ article }), {
        status: 200,
        headers: { "content-type": "application/json", etag: "etag-1" },
      }),
    )).resolves.toEqual({ project, article, etag: "etag-1" });
  });
});
