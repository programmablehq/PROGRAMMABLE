import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { changedPaths } from "./interface-plan.mjs";

export function isInterfaceMaintenance(paths, readPair) {
  if (!paths?.length) return false;
  try {
    for (const path of paths) {
      if (/^(?:AGENTS\.md|scripts\/ci\/(?:README\.md|interface-[^/]+\.mjs|reuse-interface-verification(?:\.test)?\.mjs|verify-interface(?:-workflow\.test)?\.mjs|classify-verify-paths\.test\.mjs))$/u.test(path)) continue;
      if (/^tests\/(?!browser\/).*\.test\.tsx?$/u.test(path)) {
        const [before, after] = readPair(path);
        if (before && after === null) continue;
        return false;
      }
      if (path === "package.json") {
        const normalize = text => {
          const value = JSON.parse(text);
          for (const key of Object.keys(value.scripts))
            if (/^(?:verify:interface(?::|$)|test:interface(?::|$)|test:ci-scope$)/u.test(key)) delete value.scripts[key];
          return JSON.stringify(value);
        };
        const [before, after] = readPair(path);
        if (normalize(before) !== normalize(after)) return false;
      } else if (path === ".github/workflows/verify.yml") {
        const normalize = text => text.replace(/^  (?:scope|interface-quality|interface-browser-build):\n[\s\S]*?(?=^  [a-z][\w-]*:\n|$(?![\s\S]))/gmu, "");
        const [before, after] = readPair(path);
        if (normalize(before) !== normalize(after)) return false;
      } else if (path === ".github/workflows/verify-module-launch-sources.yml") {
        const [before, after] = readPair(path);
        if (before.split("\n").filter(line => !(line.includes("MODULE_MODE_SOLC=")
          && line.includes("node --test"))).join("\n") !== after) return false;
      } else return false;
    }
    return true;
  } catch { return false; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...process.env, PROGRAMMABLE_CI_BASE_SHA: process.env.BASE_SHA, PROGRAMMABLE_CI_HEAD_SHA: process.env.HEAD_SHA };
  if (isInterfaceMaintenance(changedPaths(env), path => [env.BASE_SHA, env.HEAD_SHA].map(sha => {
    try { return execFileSync("git", ["show", `${sha}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
    catch { return null; }
  }))) {
    const path = process.argv[2];
    writeFileSync(path, readFileSync(path, "utf8").split("\n").map(line => {
      if (!line.includes("=")) return line;
      const [key] = line.split("=");
      return `${key}=${key === "interface" ? "true" : "false"}`;
    }).join("\n") + "\ninterface_maintenance=true\n");
    console.log("Verification maintenance: test the Interface pipeline; contract and production inputs are unchanged.");
  }
}
