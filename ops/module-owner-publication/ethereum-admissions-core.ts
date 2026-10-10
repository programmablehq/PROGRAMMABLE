import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import publishers from "@/config/module-foundation/owner-publishers.json";
import host from "@/contracts/deployments/ethereum-module-release-v2.json";
import { nativeCanonicalJson } from "@/lib/module-mode/native-catalog";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { verifyFoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-verification";
import { verifyFoundationOwnerRuntimeV1 } from "@/lib/module-foundation/owner-runtime";

/** Generate the installed API artifact only from verified owner publications.
 * The API separately pins its digest at deployment and never reads request-supplied admissions. */
export async function buildEthereumAdmissions(publications: unknown[], sourceCommit: string,
  allowedPublishers: readonly string[], protocolReleaseDigest = host.releaseDigest) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit) || publications.length < 1 || publications.length > 127) throw Error("Invalid admission input bounds.");
  const modules = [];
  const factories = new Set<string>();
  for (const input of publications) {
    const publication = await verifyFoundationOwnerPublicationV1(input, allowedPublishers);
    if (publication.release.chainId !== 1 || publication.protocolReleaseDigest !== protocolReleaseDigest
      || factories.has(publication.release.factory.toLowerCase())) throw Error("Duplicate factory or wrong Ethereum host.");
    factories.add(publication.release.factory.toLowerCase());
    const { factory, factoryCodeHash, moduleCodeHash, descriptorHash } = publication.release;
    modules.push({ factory, factoryCodeHash, moduleCodeHash, descriptorHash, publicationDigest: publication.publicationDigest });
  }
  modules.sort((a, b) => a.factory.toLowerCase().localeCompare(b.factory.toLowerCase()));
  const artifact = { schemaVersion: "programmable.ethereum-module-admissions.v1", protocolReleaseDigest, sourceCommit, modules };
  const json = nativeCanonicalJson(artifact);
  return { artifact, json, digest: `sha256:${createHash("sha256").update(json).digest("hex")}` };
}

export async function run(args: string[], root: string) {
  const [output, ...paths] = args;
  if (!output || !paths.length) throw Error("Usage: ethereum-admissions.mjs OUTPUT PUBLICATION [PUBLICATION...]");
  const publications = [];
  const profile = foundationChainProfile(1);
  const client = createPublicClient({ chain: profile.chain, transport: http(process.env.ECONOMIC_ETH_RPC ?? profile.publicRpcUrls[0], { retryCount: 0, timeout: 30_000 }) });
  for (const path of paths) {
    const bytes = await readFile(path);
    if (bytes.byteLength > 16 * 1024 * 1024) throw Error("Publication exceeds the size limit.");
    const publication = await verifyFoundationOwnerPublicationV1(JSON.parse(bytes.toString("utf8")), publishers.wallets);
    if (publication.release.chainId !== 1) throw Error("Ethereum publications are required.");
    await verifyFoundationOwnerRuntimeV1(publication, client);
    publications.push(publication);
  }
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const result = await buildEthereumAdmissions(publications, sourceCommit, publishers.wallets);
  await writeFile(output, result.json + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output, moduleCount: result.artifact.modules.length, digest: result.digest, activated: false }));
}
