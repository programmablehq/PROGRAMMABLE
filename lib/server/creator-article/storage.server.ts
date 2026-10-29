import "server-only";

import { createHash } from "node:crypto";

import {
  BlobPreconditionFailedError,
  get,
  put,
} from "@vercel/blob";
import { getAddress, isAddress } from "viem";

import {
  canonicalCreatorArticleV1,
  CREATOR_ARTICLE_SCHEMA_V1,
  parseCreatorArticleDraftV1,
  parseCreatorArticleV1,
  type CreatorArticleDraftV1,
  type CreatorArticleV1,
} from "../../creator-article/contract-v1";

const POINTER_SCHEMA = "programmable.creator-article-pointer.v1" as const;
const MAXIMUM_ARTICLE_BLOB_BYTES = 256_000;

type ArticleIdentityV1 = Readonly<{
  chainId: 1;
  tokenAddress: `0x${string}`;
}>;

type ArticlePointerV1 = Readonly<{
  schemaVersion: typeof POINTER_SCHEMA;
  chainId: 1;
  tokenAddress: `0x${string}`;
  creatorAddress: `0x${string}`;
  revision: number;
  revisionPath: string;
  contentSha256: `sha256:${string}`;
  createdAt: string;
  updatedAt: string;
}>;

export type CreatorArticleReadV1 = Readonly<{
  article: CreatorArticleV1;
  etag: string;
  contentSha256: `sha256:${string}`;
}>;

export type PublishCreatorArticleV1 = Readonly<{
  draft: CreatorArticleDraftV1;
  creatorAddress: `0x${string}`;
  expectedEtag: string | null;
}>;

export interface CreatorArticleStoreV1 {
  readCurrent(input: ArticleIdentityV1): Promise<CreatorArticleReadV1 | null>;
  publish(input: PublishCreatorArticleV1): Promise<CreatorArticleReadV1>;
}

export interface CreatorArticleBlobBoundaryV1 {
  read(pathname: string): Promise<Readonly<{ text: string; etag: string }> | null>;
  write(input: Readonly<{
    pathname: string;
    text: string;
    ifMatch: string | null;
    immutable: boolean;
  }>): Promise<Readonly<{ pathname: string; etag: string }>>;
}

export class CreatorArticleRevisionConflictV1 extends Error {
  constructor() {
    super("creator_article_revision_conflict");
    this.name = "CreatorArticleRevisionConflictV1";
  }
}

export class CreatorArticleBlobPreconditionErrorV1 extends Error {
  constructor() {
    super("creator_article_blob_precondition_failed");
    this.name = "CreatorArticleBlobPreconditionErrorV1";
  }
}

export function createCreatorArticleStoreV1(input: Readonly<{
  blob: CreatorArticleBlobBoundaryV1;
  now?: () => Date;
}>): CreatorArticleStoreV1 {
  const now = input.now ?? (() => new Date());
  return Object.freeze({
    async readCurrent(identity: ArticleIdentityV1) {
      const normalized = normalizeIdentity(identity);
      const pointerRead = await input.blob.read(pointerPath(normalized));
      if (pointerRead === null) return null;
      const pointer = parsePointer(pointerRead.text, normalized);
      const revisionRead = await input.blob.read(pointer.revisionPath);
      if (revisionRead === null) throw new TypeError("Creator article revision is unavailable");
      const article = parseCreatorArticleV1(parseBoundedJson(revisionRead.text));
      if (
        article.chainId !== normalized.chainId
        || article.tokenAddress.toLowerCase() !== normalized.tokenAddress.toLowerCase()
        || article.revision !== pointer.revision
        || sha256(canonicalCreatorArticleV1(article)) !== pointer.contentSha256
      ) throw new TypeError("Creator article pointer binding is invalid");
      return Object.freeze({
        article,
        etag: pointerRead.etag,
        contentSha256: pointer.contentSha256,
      });
    },
    async publish(publishInput: PublishCreatorArticleV1) {
      const draft = parseCreatorArticleDraftV1(publishInput.draft);
      if (!isAddress(publishInput.creatorAddress)) {
        throw new TypeError("Creator article creator is invalid");
      }
      const creatorAddress = getAddress(publishInput.creatorAddress);
      const identity = normalizeIdentity(draft);
      const current = await this.readCurrent(identity);
      if (
        (current === null && publishInput.expectedEtag !== null)
        || (current !== null && publishInput.expectedEtag !== current.etag)
      ) throw new CreatorArticleRevisionConflictV1();
      const timestamp = now().toISOString();
      const article = parseCreatorArticleV1({
        schemaVersion: CREATOR_ARTICLE_SCHEMA_V1,
        chainId: identity.chainId,
        tokenAddress: identity.tokenAddress,
        revision: (current?.article.revision ?? 0) + 1,
        status: "published",
        title: draft.title,
        bannerImage: draft.bannerImage,
        document: draft.document,
        createdAt: current?.article.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
      const articleText = canonicalCreatorArticleV1(article);
      const contentSha256 = sha256(articleText);
      const revisionPathname = revisionPath(identity, contentSha256);
      try {
        await input.blob.write({
          pathname: revisionPathname,
          text: articleText,
          ifMatch: null,
          immutable: true,
        });
      } catch (error) {
        if (!(error instanceof CreatorArticleBlobPreconditionErrorV1)) throw error;
        const existing = await input.blob.read(revisionPathname);
        if (existing?.text !== articleText) throw error;
      }
      const pointer: ArticlePointerV1 = Object.freeze({
        schemaVersion: POINTER_SCHEMA,
        chainId: identity.chainId,
        tokenAddress: identity.tokenAddress,
        creatorAddress,
        revision: article.revision,
        revisionPath: revisionPathname,
        contentSha256,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      });
      let pointerWrite;
      try {
        pointerWrite = await input.blob.write({
          pathname: pointerPath(identity),
          text: canonicalize(pointer),
          ifMatch: current?.etag ?? null,
          immutable: false,
        });
      } catch (error) {
        if (error instanceof CreatorArticleBlobPreconditionErrorV1) {
          throw new CreatorArticleRevisionConflictV1();
        }
        throw error;
      }
      // Vercel Blob's public pointer can remain cached briefly after an exact
      // conditional overwrite. The immutable article bytes and the successful
      // pointer-write receipt already bind this revision; re-reading the public
      // URL here can only turn a completed publish into a false 503.
      return Object.freeze({
        article,
        etag: pointerWrite.etag,
        contentSha256,
      });
    },
  });
}

export function createProductionCreatorArticleStoreV1(): CreatorArticleStoreV1 {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new TypeError("BLOB_READ_WRITE_TOKEN is not configured");
  return createCreatorArticleStoreV1({
    blob: Object.freeze({
      async read(pathname: string) {
        const result = await get(pathname, {
          access: "public",
          token,
          useCache: false,
          headers: { "accept-encoding": "identity" },
        });
        if (result === null) return null;
        if (result.statusCode !== 200 || result.stream === null) {
          throw new TypeError("Creator article blob read is invalid");
        }
        if (
          result.blob.size > MAXIMUM_ARTICLE_BLOB_BYTES
          || result.blob.contentType !== "application/json"
        ) throw new TypeError("Creator article blob metadata is invalid");
        return Object.freeze({
          text: await readBoundedStream(result.stream),
          etag: result.blob.etag,
        });
      },
      async write(writeInput: Readonly<{
        pathname: string;
        text: string;
        ifMatch: string | null;
        immutable: boolean;
      }>) {
        try {
          const result = await put(writeInput.pathname, writeInput.text, {
            access: "public",
            token,
            addRandomSuffix: false,
            allowOverwrite: !writeInput.immutable && writeInput.ifMatch !== null,
            contentType: "application/json",
            cacheControlMaxAge: 60,
            ...(writeInput.ifMatch === null ? {} : { ifMatch: writeInput.ifMatch }),
          });
          if (result.pathname !== writeInput.pathname || !result.etag) {
            throw new TypeError("Creator article blob write is invalid");
          }
          return Object.freeze({ pathname: result.pathname, etag: result.etag });
        } catch (error) {
          if (error instanceof BlobPreconditionFailedError) {
            throw new CreatorArticleBlobPreconditionErrorV1();
          }
          throw error;
        }
      },
    }),
  });
}

function normalizeIdentity(input: Readonly<{ chainId: number; tokenAddress: string }>): ArticleIdentityV1 {
  if (input.chainId !== 1 || !isAddress(input.tokenAddress)) {
    throw new TypeError("Creator article identity is invalid");
  }
  return Object.freeze({ chainId: 1, tokenAddress: getAddress(input.tokenAddress) });
}

function basePath(identity: ArticleIdentityV1) {
  return `creator-articles/v1/eip155-${identity.chainId}/${identity.tokenAddress.toLowerCase()}`;
}

function pointerPath(identity: ArticleIdentityV1) {
  return `${basePath(identity)}/current.json`;
}

function revisionPath(identity: ArticleIdentityV1, digest: `sha256:${string}`) {
  return `${basePath(identity)}/revisions/${digest.slice("sha256:".length)}.json`;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function parsePointer(text: string, identity: ArticleIdentityV1): ArticlePointerV1 {
  const value = parseBoundedJson(text);
  if (!isRecord(value)) throw new TypeError("Creator article pointer is invalid");
  const expectedKeys = [
    "schemaVersion", "chainId", "tokenAddress", "creatorAddress", "revision",
    "revisionPath", "contentSha256", "createdAt", "updatedAt",
  ];
  if (Object.keys(value).length !== expectedKeys.length
    || expectedKeys.some((key) => !(key in value))
    || value.schemaVersion !== POINTER_SCHEMA
    || value.chainId !== 1
    || typeof value.tokenAddress !== "string" || !isAddress(value.tokenAddress)
    || value.tokenAddress.toLowerCase() !== identity.tokenAddress.toLowerCase()
    || typeof value.creatorAddress !== "string" || !isAddress(value.creatorAddress)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || typeof value.contentSha256 !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value.contentSha256)
    || typeof value.revisionPath !== "string"
    || value.revisionPath !== revisionPath(identity, value.contentSha256 as `sha256:${string}`)
    || typeof value.createdAt !== "string" || new Date(value.createdAt).toISOString() !== value.createdAt
    || typeof value.updatedAt !== "string" || new Date(value.updatedAt).toISOString() !== value.updatedAt
  ) throw new TypeError("Creator article pointer is invalid");
  return Object.freeze({
    schemaVersion: POINTER_SCHEMA,
    chainId: 1,
    tokenAddress: getAddress(value.tokenAddress),
    creatorAddress: getAddress(value.creatorAddress),
    revision: Number(value.revision),
    revisionPath: value.revisionPath,
    contentSha256: value.contentSha256 as `sha256:${string}`,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function parseBoundedJson(text: string): unknown {
  if (!text || Buffer.byteLength(text, "utf8") > MAXIMUM_ARTICLE_BLOB_BYTES) {
    throw new TypeError("Creator article blob is invalid");
  }
  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean"
    || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new TypeError("Creator article pointer is invalid");
}

async function readBoundedStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAXIMUM_ARTICLE_BLOB_BYTES) {
      await reader.cancel();
      throw new TypeError("Creator article blob is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
