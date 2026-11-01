import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import match, { minimatch, Minimatch } from "minimatch";

const require = createRequire(import.meta.url);
const legacy = require("minimatch");

test("legacy callable and modern named imports agree", () => {
  for (const [file, pattern, options, expected] of [
    ["src/page.tsx", "**/*.{ts,tsx}", {}, true],
    ["src/page.js", "**/*.{ts,tsx}", {}, false],
    [".next/server.js", "**/*.js", {}, false],
    [".next/server.js", "**/*.js", { dot: true }, true],
    ["src/test.ts", "!**/*.test.ts", {}, true],
    ["src/page.test.ts", "!**/*.test.ts", {}, false],
    ["SRC/Page.TSX", "src/*.tsx", { nocase: true }, true],
  ]) {
    assert.equal(legacy(file, pattern, options), expected);
    assert.equal(minimatch(file, pattern, options), expected);
    assert.equal(match(file, pattern, options), expected);
  }
});

test("legacy helper APIs remain callable", () => {
  assert.equal(legacy.defaults({ nocase: true })("FILE.TS", "*.ts"), true);
  assert.deepEqual(["a.js", "b.ts"].filter(legacy.filter("*.ts")), ["b.ts"]);
  assert.deepEqual(legacy.match(["src/a.ts", "test/b.ts"], "src/**"), ["src/a.ts"]);
  assert.deepEqual(legacy.braceExpand("file.{ts,tsx}"), ["file.ts", "file.tsx"]);
  assert.equal(new legacy.Minimatch("**/*.ts").match("src/a.ts"), true);
  assert.equal(new Minimatch("**/*.ts").match("src/a.ts"), true);
});

test("installed legacy glob resolves nested, brace and ignored paths with the safe matcher", async () => {
  const glob = require("glob");
  const cwd = mkdtempSync(join(tmpdir(), "programmable-glob-"));
  try {
    mkdirSync(join(cwd, "src/nested"), { recursive: true });
    for (const path of ["src/a.js", "src/b.ts", "src/nested/c.ts", "src/.hidden.ts", "skip.ts"])
      writeFileSync(join(cwd, path), "");
    const patterns = [
      ["src/**/*.{js,ts}", {}, ["src/a.js", "src/b.ts", "src/nested/c.ts"]],
      ["**/*.ts", { ignore: ["skip.ts", "src/nested/**"] }, ["src/b.ts"]],
      ["src/**/*.ts", { dot: true }, ["src/.hidden.ts", "src/b.ts", "src/nested/c.ts"]],
    ];
    for (const [pattern, options, expected] of patterns) {
      assert.deepEqual(glob.sync(pattern, { cwd, nodir: true, ...options }).sort(), expected);
      const found = await new Promise((resolve, reject) => glob(pattern, { cwd, nodir: true, ...options }, (error, paths) => error ? reject(error) : resolve(paths)));
      assert.deepEqual(found.sort(), expected);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("optimization-level two handles repeated recursive parents without expansion", () => {
  const pattern = Array(24).fill("**/..").join("/") + "/file.ts";
  const code = `const m=require('minimatch'); console.log(typeof m('src/file.ts',${JSON.stringify(pattern)},{optimizationLevel:2}));`;
  assert.equal(execFileSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: 2000 }).trim(), "boolean");
});
