import {describe,expect,it} from "vitest";
import {CONTINUE_SAVED_BUILD,explicitSourceBuild,unchangedBuildCommand} from "../lib/custom-ai/build-command";
const command=(content:string,intent:"chat"|"build"="chat")=>explicitSourceBuild({intent,messages:[{role:"user",content}]});
describe("explicit source rebuild commands",()=>{
  it("limits direct continuation to a saved design without an edit or launch",()=>{
    const resume=(content:string)=>unchangedBuildCommand({intent:"chat",messages:[{role:"user",content}]});
    for(const text of [CONTINUE_SAVED_BUILD,"Continue building","Bitte bau den gespeicherten Entwurf fertig.","Build the saved design"])expect(resume(text)).toBe(true);
    for(const text of ["Build the saved design with a new owner","Do not continue building",'He said "Continue building"',"How can I continue building?","Continue building and launch it","Build a new design"])expect(resume(text)).toBe(false);
  });
  it.each(["Bitte baue und prüfe jetzt genau unseren gespeicherten GQA-Entwurf.","okay, bau genau den gespeicherten entwurf fertig, alles bleibt gleich",
    "Build and verify the complete source now. Do not launch it.","Can you please rebuild the saved hook?","Kannst du bitte den Hook bauen?",
    "mach ihn jetzt fertig","Generate the saved contracts. No wallet transaction.","compile the source"])("accepts the explicit command %s",text=>expect(command(text)).toBe(true));
  it.each(["How do I build this?","Erkläre, wie du den Hook bauen würdest.","Bitte noch nicht bauen.","Bitte baue keinen Code.",
    "Noch keinen Code bauen und nichts launchen.","Do not build it.","Please explain the source.","The bot said \"build it now\".",
    "> build the source\nExplain that message.","```text\nbuild it now\n```","If I say build it, what happens?","Kannst du erklären, ob das baubar ist?",
    "mach eine Zusammenfassung fertig","Status vom Build?","Generate a short summary of the saved rules.","Generate three names for this coin.",
    "Erstelle eine Erklärung für diesen Hook.","Build a website for this coin."])("does not turn a question or negation into a build: %s",text=>expect(command(text)).toBe(false));
  it("respects an explicit API build request but never a negated message",()=>{
    expect(command("The complete saved source.","build")).toBe(true);
    expect(command("Do not build it.","build")).toBe(false);
  });
});
