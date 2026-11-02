import {expect,test} from "@playwright/test";

test("continues a saved failed build without overwriting an unsent message or launching",async({page})=>{
 const requests:Record<string,unknown>[]=[];
 const intent={version:1,id:"recovery-design",revision:"a".repeat(64),changes:[],unresolved:[],requirements:[
  {id:"counter",kind:"behavior",text:"Count every successful swap",open:null,origin:{kind:"legacy"}},
  {id:"no-owner",kind:"constraint",text:"No owner permissions",open:null,origin:{kind:"legacy"}},
 ]};
 let otherActions=0;
 await page.route("**/api/custom-ai**",async route=>{
  const request=route.request();
  if(new URL(request.url()).pathname!=="/api/custom-ai"){otherActions++;return route.fulfill({status:404,json:{error:"No launch request expected"}});}
  requests.push(request.postDataJSON());
  return route.fulfill({json:{reply:"The saved build stopped before source generation.",intent,change:"blocked",buildIssue:{stage:"scenarios",code:"invalid-declaration"}}});
 });
 await page.goto("/launch/custom-ai");
 const composer=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
 await composer.fill("Build my swap-counter hook. Keep it as a test, do not launch.");await composer.press("Enter");
 const resume=page.getByRole("button",{name:"Continue building",exact:true});await expect(resume).toBeEnabled();
 await composer.fill("Also change the name, but I have not sent this yet.");await expect(resume).toBeDisabled();
 await expect(composer).toHaveValue("Also change the name, but I have not sent this yet.");expect(requests).toHaveLength(1);
 await composer.fill("");await resume.click();
 await expect.poll(()=>requests.length).toBe(2);
 const messages=requests[1].messages as {role:string;content:string}[];
 expect(messages.at(-1)?.content).toContain("Keep every saved rule unchanged");
 expect(messages.at(-1)?.content).toContain("Do not launch");
 expect(otherActions).toBe(0);
 await expect(resume).toBeEnabled();
});
