import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export async function createCustomLaunchFlowServer() {
  const root = process.cwd();
  const bundle = await build({ entryPoints: [resolve(root, "tests/browser/fixtures/custom-launch-flow.tsx")], bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/fixture-output", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, external: ["/brand/*", "/fonts/*"],
    plugins: [{ name: "local-launch-navigation", setup(plugin) {
      plugin.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `const router = { push: href => { window.__customLaunchFixture.navigated = href; history.pushState(null, '', href); } }; export const useRouter = () => router;` }));
    } }],
  });
  const sources = new Map(bundle.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (sources.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(sources.get(url.pathname)); return; }
    if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/")) {
      const base = resolve(root, "public"), file = resolve(base, "." + url.pathname);
      if (!file.startsWith(base + sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader("Content-Type", file.endsWith(".woff2") ? "font/woff2" : "image/svg+xml"); response.end(await readFile(file)); } catch { response.writeHead(404); response.end(); } return;
    }
    response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Custom Launch local QA</title><link rel="stylesheet" href="/fixture.css"><style>body{background:#000;color:#fff;font-family:system-ui,sans-serif}main{margin-inline:auto;padding-inline:24px}button,input{font:inherit}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createCustomLaunchFlowServer(); const port = Number(process.env.PORT || 4318);
  server.listen(port, "127.0.0.1", () => process.stdout.write(`Custom Launch QA: http://127.0.0.1:${port}/developers/api-keys?view=history&chainId=4663&launchId=10000000-0000-4000-8000-000000000001\n`));
}
