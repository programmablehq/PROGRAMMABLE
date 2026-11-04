import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MessageContent } from "@/components/custom-ai/message-content";

it("cleans assistant prose while retaining the exact user input, inline code, links and source", () => {
  const content = "Your idea — with a falling fee.\n\n---\n\nKeep `a—b` and https://example.org/a—b\n\n```solidity\n// exact — source\n```";
  const assistant = renderToStaticMarkup(<MessageContent content={content} assistant />);
  const user = renderToStaticMarkup(<MessageContent content={content} />);
  expect(assistant).toContain("Your idea, with a falling fee.");
  expect(assistant).not.toContain("---");
  expect(assistant).toContain("<code>a—b</code>");
  expect(assistant).toContain('href="https://example.org/a—b"');
  expect(assistant).toContain("// exact — source\n</code>");
  expect(user).toContain("Your idea — with a falling fee.");
  expect(user).toContain("---");
});

it("uses the completed message structure while streaming, without offering incomplete code to copy", () => {
  const content = "Two ideas:\n- A falling fee\n- A fee split\n\n```solidity\nuint256 fee = 50;\n```";
  const streaming = renderToStaticMarkup(<MessageContent content={content} assistant streaming />);
  const complete = renderToStaticMarkup(<MessageContent content={content} assistant />);
  expect(streaming).toContain("<ul><li>A falling fee</li><li>A fee split</li></ul>");
  expect(complete).toContain("<ul><li>A falling fee</li><li>A fee split</li></ul>");
  expect(streaming).not.toContain("Copy code");
  expect(complete).toContain("Copy code");
});
