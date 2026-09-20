import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";

const root = new URL("./dist/", import.meta.url).pathname;
const fixtures = process.argv.includes("--fixtures");
const types = { html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", json: "application/json",
  png: "image/png", woff2: "font/woff2", ico: "image/x-icon" };
const upstreams = {
  "/module-mode/releases": "https://raw.githubusercontent.com/programmablehq/PROGRAMMABLE/production/config/module-foundation/index-releases.json",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
    if (upstreams[url.pathname]) {
      const upstream = await fetch(upstreams[url.pathname], { signal: AbortSignal.timeout(15000) });
      response.writeHead(upstream.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(await upstream.text()); return;
    }
    if (fixtures && url.pathname === "/module-mode-qa.js") {
      const result = await build({ entryPoints: [new URL("./test-fixtures/module-mode.mjs", import.meta.url).pathname],
        bundle: true, format: "esm", platform: "browser", write: false });
      response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(result.outputFiles[0].contents); return;
    }
    if (fixtures && url.pathname === "/module-mode-qa.html") {
      const html = await readFile(resolve(root, "module-mode.html"), "utf8");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html.replace("./module-mode.js", "./module-mode-qa.js").replace("Die Platform Fees aller Foundation Launches.", "Lokale Testdaten. Es wird keine echte Transaktion gesendet.")); return;
    }
    const path = resolve(root, "." + (url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403); response.end(); return; }
    response.writeHead(200, { "Content-Type": types[path.split(".").pop()] ?? "application/octet-stream" });
    response.end(await readFile(path));
  } catch { if (!response.headersSent) response.writeHead(503); response.end("Not available"); }
});
server.listen(4182, "127.0.0.1", () => console.log("Fee claim preview: http://127.0.0.1:4182/module-mode.html"));
