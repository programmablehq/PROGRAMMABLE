import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod, link, lstat, mkdir, open, readFile, realpath, rename, stat, unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parseStrictJson } from "./canonical-json.mjs";

const execFileAsync = promisify(execFile);

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Digest(bytes) {
  return `sha256:${sha256Hex(bytes)}`;
}

export async function readStrictJsonFile(filePath, maximumBytes = 16_777_216) {
  const bytes = await readFile(filePath);
  const source = decodeExactUtf8(bytes, filePath);
  return { bytes, value: parseStrictJson(source, { maximumBytes }) };
}

export function decodeExactUtf8(bytes, label = "input") {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!Buffer.from(source, "utf8").equals(Buffer.from(bytes))) {
    throw new TypeError(`${label} is not exact UTF-8`);
  }
  return source;
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function assertPlainObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

export function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function assertAllowedKeys(value, required, optional, label) {
  assertPlainObject(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unexpected field ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing ${key}`);
  }
}

export function canonicalRelativePath(value, label = "path") {
  if (typeof value !== "string" || value.length === 0 || value !== value.normalize("NFC")) {
    throw new TypeError(`${label} must be a non-empty NFC path`);
  }
  if (value.includes("\\") || value.startsWith("/") || value.includes("\0")) {
    throw new TypeError(`${label} must be a relative POSIX path`);
  }
  if (/%(?:2f|2F|5c|5C)/.test(value)) throw new TypeError(`${label} contains an encoded separator`);
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new TypeError(`${label} contains an empty or dot segment`);
  }
  for (const segment of segments) {
    if (/\p{Cc}/u.test(segment)) throw new TypeError(`${label} contains a control character`);
  }
  return value;
}

export function resolveInside(root, relativePath, label = "path") {
  const canonical = canonicalRelativePath(relativePath, label);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...canonical.split("/"));
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new TypeError(`${label} escapes the source root`);
  }
  return resolved;
}

/**
 * Rejects symlinks in every existing component below an already-real root.
 * Call immediately before a write; this is a lexical/physical target guard,
 * not a substitute for exclusive creation or an atomic rename.
 */
export async function assertNoSymlinkWritePath(root, filePath, label = "write path") {
  const realRoot = await realpath(path.resolve(root));
  const absolute = path.resolve(filePath);
  if (absolute === realRoot || !absolute.startsWith(`${realRoot}${path.sep}`)) {
    throw new TypeError(`${label} escapes its real root`);
  }
  const relative = path.relative(realRoot, absolute);
  let cursor = realRoot;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    let metadata;
    try {
      metadata = await lstat(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new TypeError(`${label} contains a symbolic link`);
    if (cursor !== absolute && !metadata.isDirectory()) {
      throw new TypeError(`${label} has a non-directory parent`);
    }
    if (cursor === absolute && !metadata.isFile()) {
      throw new TypeError(`${label} existing target is not a regular file`);
    }
  }
  return absolute;
}

export async function atomicWrite(filePath, bytes, mode = 0o600) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, "wx", mode);
  let prepared = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    prepared = true;
  } finally {
    await handle.close();
    if (!prepared) {
      await unlink(temporary).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
  try {
    await rename(temporary, filePath);
    await chmod(filePath, mode);
    await syncDirectory(directory);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

export async function atomicCreate(filePath, bytes, mode = 0o600) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, "wx", mode);
  let prepared = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    prepared = true;
  } finally {
    await handle.close();
    if (!prepared) {
      await unlink(temporary).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
  try {
    await link(temporary, filePath);
    await chmod(filePath, mode);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  await syncDirectory(directory);
}

async function syncDirectory(directory) {
  // Windows does not support syncing directories through Node's file handles.
  // The temporary file is still synced before rename/link; file errors propagate.
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function defaultStateDirectory() {
  if (process.env.PROGRAMMABLE_LAUNCH_STATE_DIR) {
    return path.resolve(process.env.PROGRAMMABLE_LAUNCH_STATE_DIR);
  }
  if (process.env.XDG_STATE_HOME) {
    return path.join(path.resolve(process.env.XDG_STATE_HOME), "programmable", "launch");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Programmable", "launch");
  }
  return path.join(os.homedir(), ".local", "state", "programmable", "launch");
}

export async function loadApiKey() {
  const fromEnvironment = process.env.PROGRAMMABLE_API_KEY;
  if (typeof fromEnvironment === "string" && fromEnvironment.length > 0) {
    return validateApiKey(fromEnvironment);
  }
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/security",
        ["find-generic-password", "-s", "api.programmable.market", "-a", "PROGRAMMABLE_API_KEY", "-w"],
        { encoding: "utf8", maxBuffer: 8_192 },
      );
      return validateApiKey(stdout.trim());
    } catch {
      throw new Error(
        "PROGRAMMABLE_API_KEY is unset and no api.programmable.market key was found in macOS Keychain",
      );
    }
  }
  if (process.platform === "linux") {
    try {
      const { stdout } = await execFileAsync(
        "secret-tool",
        ["lookup", "service", "api.programmable.market", "account", "PROGRAMMABLE_API_KEY"],
        { encoding: "utf8", maxBuffer: 8_192 },
      );
      return validateApiKey(stdout.trim());
    } catch {
      throw new Error(
        "PROGRAMMABLE_API_KEY is unset and no api.programmable.market key was found in the OS secret store",
      );
    }
  }
  throw new Error("Set PROGRAMMABLE_API_KEY in an encrypted environment or supported OS secret store");
}

function validateApiKey(value) {
  const walletKey = /^pm_live_[A-Za-z0-9_-]{16,512}$/u;
  const partnerKey = /^pm_partner_(?:root_)?[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/u;
  if (!walletKey.test(value) && !partnerKey.test(value)) {
    throw new TypeError("PROGRAMMABLE_API_KEY has an invalid shape");
  }
  return value;
}

export async function assertRegularFile(filePath, label) {
  const observed = await stat(filePath);
  if (!observed.isFile()) throw new TypeError(`${label} is not a regular file`);
  return observed;
}
