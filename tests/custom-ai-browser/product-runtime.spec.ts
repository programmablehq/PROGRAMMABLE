import {once} from "node:events";
import {createServer,type Server} from "node:http";
import {build} from "esbuild";
import {test,expect} from "@playwright/test";
let server:Server,origin:string;
test.beforeAll(async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Panel from './components/custom-ai/product-runtime';
    import './app/globals.css';import styles from './components/custom-ai/workspace.module.css';
    createRoot(document.getElementById('root')).render(<main className={styles.workspace}><section style={{padding:24,width:'100%',maxWidth:700,margin:'auto'}}><h1>River rewards</h1><p>Your saved product</p><Panel preparationId="runtime-preparation-0001" sourceId="runtime-source-0001" chainId={1} headers={async()=>({Authorization:'synthetic-local-session'})}/></section></main>);`,
    loader:"tsx",resolveDir:process.cwd()},bundle:true,platform:"browser",format:"esm",jsx:"automatic",write:false,outdir:"/fixture-output",define:{"process.env.NODE_ENV":'"production"'}});
  server=createServer((req,res)=>{
    const asset=bundle.outputFiles.find(file=>req.url===(file.path.endsWith(".css")?"/fixture.css":"/fixture.js"));
    if(asset){res.setHeader("Content-Type",asset.path.endsWith(".css")?"text/css":"text/javascript");res.end(asset.contents);return;}
    res.setHeader("Content-Type","text/html");res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#090b0c;color:#f4f4f4;font:16px/1.5 Arial}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });server.listen(0,"127.0.0.1");await once(server,"listening");const addr=server.address();if(!addr||typeof addr==="string")throw Error("Missing renderer");origin=`http://127.0.0.1:${addr.port}`;
});
test.afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
for(const width of [1440,360])test(`requested contract snapshot stays usable at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});let reads=0,wrongSource=false;const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/custom-ai/product-runtime?*",async route=>{
    reads++;expect(route.request().method()).toBe("GET");expect(route.request().headers().authorization).toBe("synthetic-local-session");
    await route.fulfill({json:{runtime:{version:1,state:"contracts-observed",providerCount:2,sourceBinding:`sha256:${"1".repeat(64)}`,implementationId:`sha256:${"2".repeat(64)}`,
      preparationId:"runtime-preparation-0001",sourceId:wrongSource?"another-product":"runtime-source-0001",chainId:1,transactionHash:`0x${"a".repeat(64)}`,launchId:`0x${"b".repeat(64)}`,
      checkedAt:"2026-11-04T12:00:00.000Z",block:{number:"100",hash:`0x${"c".repeat(64)}`},components:[{id:"vault",name:"Holder reward vault",address:`0x${"9".repeat(40)}`,runtimeCodeHash:`0x${"d".repeat(64)}`}],actions:[]}}});
  });
  await page.goto(origin);const summary=page.locator("summary").filter({hasText:"Deployed contracts"});await expect(summary).toBeVisible();expect(reads).toBe(0);
  await summary.focus();await page.keyboard.press("Enter");await expect(page.getByRole("button",{name:"Check contracts",exact:true})).toBeVisible();expect(reads).toBe(0);
  await page.getByRole("button",{name:"Check contracts",exact:true}).click();await expect(page.getByText("Holder reward vault",{exact:true})).toBeVisible();expect(reads).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`product-runtime-${width}.png`),fullPage:true});
  wrongSource=true;await page.getByRole("button",{name:"Refresh contracts",exact:true}).click();await expect(page.getByRole("alert")).toContainText("does not match the saved product");
  await page.reload();await expect(summary).toBeVisible();expect(reads).toBe(2);expect(errors).toEqual([]);
});
