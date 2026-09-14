import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DeveloperLaunchMetadataPreview,
  parseHistoryPage,
  walletProjectMetadataReadyForReviewV1,
  walletProjectRequestBindingV1,
  type CustomLaunchProjectMetadataV1,
  type LaunchResource,
} from "../components/developer-launch-history";
import { canonicalBrowserSha256V2 } from
  "../lib/custom-launch/browser-authority-v2";

const owner = "0x0000000000000000000000000000000000000001";
const metadata: CustomLaunchProjectMetadataV1 = {
  schemaVersion: "programmable.project-metadata.v1",
  token: { name: "River Hook", symbol: "RIVER" },
  presentation: {
    schemaVersion: "programmable.launch-presentation-draft.v1",
    description: "A community designed custom hook.\nPrepared entirely with an agent.",
    image: {
      uri: "https://assets.example.com/river.png",
      contentSha256: `sha256:${"44".repeat(32)}`,
      mediaType: "image/png",
      byteLength: 4096,
      width: 512,
      height: 512,
    },
    links: [
      { kind: "discord", uri: "https://discord.gg/riverhook" },
      { kind: "documentation", uri: "https://docs.example.com/river" },
      { kind: "github", uri: "https://github.com/example/river-hook" },
      { kind: "other", uri: "https://example.com/river/community" },
      { kind: "other", uri: "https://example.com/river/security" },
      { kind: "telegram", uri: "https://t.me/river_hook" },
      { kind: "website", uri: "https://example.com/river" },
      { kind: "x", uri: "https://x.com/river_hook" },
    ],
  },
  tokenMetadataBinding: {
    schemaVersion: "programmable.project-token-metadata-binding.v1",
    tokenTargetId: "token",
    declarationBinding: "request-and-launch-id",
    standardReadModel: { name: true, symbol: true },
    name: { staticSource: "constructor-argument", argumentIndex: 0, argumentName: "name_" },
    symbol: { staticSource: "constructor-argument", argumentIndex: 1, argumentName: "symbol_" },
    postDeploymentReadback: "required",
  },
};

function v4Resource(projectMetadata = metadata) {
  return {
    schemaVersion: "programmable.custom-launch.v4",
    apiVersion: "v4",
    routeId: "custom-launch:create:v4",
    chainId: "4663",
    caip2: "eip155:4663",
    launchId: "90000000-0000-4000-8000-000000000009",
    requestId: "a0000000-0000-4000-8000-00000000000a",
    controller: { namespace: "eip155:4663", address: owner },
    status: "wallet_action_required",
    requestHash: `sha256:${"11".repeat(32)}`,
    profile: { profileDigest: `sha256:${"22".repeat(32)}` },
    commitments: { launchIntent: `sha256:${"33".repeat(32)}` },
    metadataCommitment: canonicalBrowserSha256V2(
      "programmable.project-metadata.v1", projectMetadata,
    ),
    projectMetadata,
    walletTransaction: null,
    preparedArtifact: null,
    onchain: null,
    failure: null,
    createdAt: "2026-09-05T12:00:00.000Z",
    updatedAt: "2026-09-05T12:00:01.000Z",
  };
}

function readResource(raw = v4Resource()) {
  return parseHistoryPage({
    schemaVersion: "programmable.custom-launch-history.v1",
    launches: [raw],
    nextCursor: null,
  }, owner);
}

function v4Launch(projectMetadata = metadata): LaunchResource {
  const page = readResource(v4Resource(projectMetadata));
  expect(page).not.toBeNull();
  return page!.launches[0]!;
}

function render(launch: LaunchResource) {
  return renderToStaticMarkup(<DeveloperLaunchMetadataPreview launch={launch} />);
}

describe("agent supplied launch metadata preview", () => {
  it("shows bound metadata while omitting GitHub from public social destinations", () => {
    const launch = v4Launch();
    const html = render(launch);
    expect(html).toContain("Robinhood Chain · 4663");
    expect(html).not.toContain("Ethereum Mainnet");
    expect(html).toContain("Required launch details");
    expect(html).not.toContain("Bound legacy launch details");
    expect(html).toContain("River Hook");
    expect(html).toContain("$RIVER");
    expect(html).toContain(">Bio<");
    expect(html).toContain(metadata.presentation.description);
    expect(html).toContain(metadata.presentation.image!.uri);
    expect(html).toContain(metadata.presentation.image!.contentSha256);
    for (const link of metadata.presentation.links) {
      if (link.kind === "github") {
        expect(html).not.toContain(`href="${link.uri}"`);
        continue;
      }
      expect(html).toContain(`href="${link.uri}"`);
      expect(html).toContain(link.uri);
    }
    expect(html).toContain("Telegram");
    expect(html).toContain("Discord");
    expect(html).not.toMatch(/<(?:input|textarea|select)\b/u);
    expect(html).not.toContain(`src="${metadata.presentation.image!.uri}"`);
    expect(html).toContain("Verifying the bound image bytes before preview.");
    expect(html).toContain("Ask your agent to make");
    expect(walletProjectMetadataReadyForReviewV1(launch)).toBe(true);
  });

  it("does not preview tampered metadata or allow that changed summary at the wallet boundary", () => {
    const launch = v4Launch();
    const changed = {
      ...launch,
      projectMetadata: { ...metadata, token: { ...metadata.token, name: "Changed name" } },
    };
    expect(render(changed)).toContain("Bound project metadata unavailable");
    expect(render(changed)).not.toContain("Changed name");
    expect(walletProjectMetadataReadyForReviewV1(changed)).toBe(false);
  });

  it.each(["description", "image", "website", "x"] as const)(
    "sends missing current V4 %s back to the agent without removing history",
    (missing) => {
      const changed = structuredClone(metadata);
      const presentation = {
        ...changed.presentation,
        ...(missing === "description" ? { description: "" } : {}),
        ...(missing === "image" ? { image: null } : {}),
        links: changed.presentation.links.filter((link) => link.kind !== missing),
      };
      const launch = v4Launch({ ...changed, presentation });
      const html = render(launch);
      expect(html).toContain("River Hook");
      expect(html).toContain("Action required");
      expect(html).toContain("Ask your agent to collect the missing launch details");
      expect(html).not.toMatch(/<(?:input|textarea|select)\b/u);
      expect(walletProjectMetadataReadyForReviewV1(launch)).toBe(false);
    },
  );

  it("keeps omitted optional Telegram and Discord optional and never fabricates destinations", () => {
    const launch = v4Launch({
      ...metadata,
      presentation: {
        ...metadata.presentation,
        links: metadata.presentation.links.filter(
          (link) => link.kind !== "telegram" && link.kind !== "discord",
        ),
      },
    });
    const html = render(launch);
    expect(html).toContain("Telegram: not supplied.");
    expect(html).toContain("Discord: not supplied.");
    expect(html).not.toContain("https://t.me/");
    expect(html).not.toContain("https://discord.gg/");
    expect(walletProjectMetadataReadyForReviewV1(launch)).toBe(true);
  });

  it("takes chain from the validated launch resource and rejects contradictory V4 chain data", () => {
    expect(readResource({ ...v4Resource(), chainId: "1" })).toBeNull();
    expect(readResource({ ...v4Resource(), caip2: "eip155:1" })).toBeNull();
    const ethereum: LaunchResource = {
      ...v4Launch(),
      schemaVersion: "programmable.custom-launch.v3",
      routeId: "custom-launch:create:v3",
      launchProfileVersion: "3.3.0",
      rawResourceV4: null,
    };
    expect(render(ethereum)).toContain("Ethereum Mainnet · 1");
    expect(render(ethereum)).not.toContain("Robinhood Chain");
  });

  it("preserves legacy history and its existing exact retry binding", () => {
    const legacy: LaunchResource = {
      ...v4Launch(),
      schemaVersion: "programmable.custom-launch.v3",
      routeId: "custom-launch:create:v3",
      launchProfileVersion: "3.1.0",
      projectMetadata: null,
      projectMetadataHash: null,
      rawResourceV4: null,
    };
    expect(render(legacy)).toContain("Legacy launch identity");
    expect(render(legacy)).toContain("Exact retries remain available");
    expect(walletProjectRequestBindingV1(legacy)?.mode).toBe("legacy-exact-retry");
  });
});
