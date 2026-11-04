import {describe,it,expect} from "vitest";
import {imageMessageURL,explicitImageMessageURL} from "../lib/custom-ai/image-message";
describe("direct image edits",()=>{
 it("recognizes plain images and short explicit commands without a model call",()=>{
  for(const message of ["https://example.org/a.png","Use this image: https://example.org/a.png","Bild: https://example.org/a.png","Nimm dieses Bild https://example.org/a.png"])
   expect(imageMessageURL(message)).toBe("https://example.org/a.png");
 });
 it("does not discard other instructions or treat a website link as an image",()=>{
  for(const message of ["Use this image https://example.org/a.png and change the fee to 2%","https://example.org","My website: https://example.org/a.png","https://user:pass@example.org/a.png","https://example.org/a.png https://example.org/b.png"])
   expect(imageMessageURL(message)).toBeUndefined();
 });
 it("attaches an explicitly labelled image while preserving mixed instructions",()=>{
  for(const message of [
   "Build PMAI7. Use https://example.org/a.png as its image, and set the fee to 1%.",
   "Build PMAI7. Image: https://example.org/a.png. Website: https://example.org",
   "Use this image https://example.org/a.png and change the fee to 2%",
   "Nutze dieses Bild https://example.org/a.png und ändere die Gebühren.",
  ])expect(explicitImageMessageURL(message)).toBe("https://example.org/a.png");
  for(const message of ["My website: https://example.org/a.png","Do not use this image https://example.org/a.png",
   "Image: https://user:pass@example.org/a.png","Image: https://example.org/a.png Image: https://example.org/b.png"])
   expect(explicitImageMessageURL(message)).toBeUndefined();
 });
});
