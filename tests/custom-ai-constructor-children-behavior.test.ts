import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createGeneralCheckBlueprint, bindGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { checkGeneralScenarios } from "../lib/custom-ai/behavior-checks.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const intent: LaunchIntent = { version: 1, id: "nested-declared-construction", revision: "a".repeat(64), unresolved: [], changes: [], requirements: [
  { id: "references", text: "Each actual child retains its declared parent and is the instance exposed by its parent", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "surface", text: "Only the agreed public functions exist", kind: "constraint", open: null, origin: { kind: "legacy" } },
] };
const common = { source: "Project.sol", allowReceive: false, allowFallback: false, surfaceRequirements: ["surface"] };
function declaration() {
  return { contracts: [{ ...common, id: "root", contract: "Root", role: "hook", arguments: [], functions: ["function child() view returns(address)", "function spawn()"] }],
    constructorChildren: [
      { ...common, id: "child", contract: "Child", role: "auxiliary", parent: "root", creation: "create", nonce: "1", value: "0", arguments: [{ contract: "root" }], functions: ["function parent() view returns(address)", "function leaf() view returns(address)"] },
      { ...common, id: "leaf", contract: "Leaf", role: "auxiliary", parent: "child", creation: "create", nonce: "1", value: "0", arguments: [{ contract: "child" }], functions: ["function parent() view returns(address)"] },
    ], allowedCalls: [], steps: [
      { id: "root-child", contract: "root", signature: "child()", expect: { status: "success", returns: [{ contract: "child" }] } },
      { id: "child-parent", contract: "child", signature: "parent()", expect: { status: "success", returns: [{ contract: "root" }] } },
      { id: "child-leaf", contract: "child", signature: "leaf()", expect: { status: "success", returns: [{ contract: "leaf" }] } },
      { id: "leaf-parent", contract: "leaf", signature: "parent()", expect: { status: "success", returns: [{ contract: "child" }] } },
    ].map(step => ({ ...step, arguments: [], from: "creator", afterSeconds: 0, value: "0", read: true, requirementIds: ["references"] })) };
}
const content = `pragma solidity 0.8.26;
contract Leaf { address public immutable parent; constructor(address p){parent=p;} }
contract Child { address public immutable parent; Leaf public immutable leaf; constructor(address p){parent=p;leaf=new Leaf(address(this));} }
contract Root { Child public immutable child; constructor(){child=new Child(address(this));} function spawn() external {new Child(address(this));} }`;
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("independent examples for observed constructor children", { timeout: 90_000 }, () => {
  let blueprint: ReturnType<typeof createGeneralCheckBlueprint>;
  beforeAll(() => { blueprint = createGeneralCheckBlueprint(declaration(), intent, 999, "cancun"); });
  async function report(source: string, declared = blueprint) {
    const project = createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "cancun" },
      sources: { "Project.sol": { content: source } }, entrypoints: declared.entrypoints }, intent, 999);
    return checkGeneralScenarios(project, await compileContractProject(project), bindGeneralCheckBlueprint(declared, project));
  }
  it("calls the actual nested instances and verifies all interfaces and all three constructors", async () => {
    const actual=await report(content);
    expect(actual).toMatchObject({ version: 2, passed: true, cases: 10, launchReady: false });
    expect(actual.execution?.steps).toHaveLength(4);
    expect(actual.execution?.steps[0].outputs[0].value).toMatch(/^0x[a-f0-9]{40}$/i);
  });
  it("forwards the one declared root amount through both child constructors", async () => {
    const raw = declaration();
    const funded = { ...raw, contracts: raw.contracts.map(contract => ({ ...contract, value: "1" })), constructorChildren: raw.constructorChildren.map(child => ({ ...child, value: "1" })) };
    const source = content.replaceAll("constructor(address p){", "constructor(address p) payable {")
      .replace("constructor(){", "constructor() payable {")
      .replaceAll("new Child(address(this))", "new Child{value:1}(address(this))")
      .replace("new Leaf(address(this))", "new Leaf{value:1}(address(this))");
    expect(await report(source, createGeneralCheckBlueprint(funded, intent, 999, "cancun"))).toMatchObject({ passed: true, cases: 10, launchReady: false });
  });
  it.each([
    ["missing", content.replace("leaf=new Leaf(address(this));", "leaf=Leaf(address(0));"), "constructor-child-missing"],
    ["wrong arguments", content.replace("leaf=new Leaf(address(this));", "leaf=new Leaf(p);"), "undeclared-deployment"],
    ["extra instance", content.replace("child=new Child(address(this));", "child=new Child(address(this));new Child(address(this));"), "undeclared-deployment"],
  ])("refuses %s construction rather than deploying a substitute child", async (_label, source, code) => {
    const actual = await report(source); expect(actual.passed).toBe(false); expect(actual.failures.some(failure => failure.code === code)).toBe(true);
  });
  it("does not let a later method create additional contracts under constructor-only permission", async () => {
    const raw = declaration(); raw.steps.push({ id: "late-create", contract: "root", signature: "spawn()", arguments: [], from: "creator", afterSeconds: 0, value: "0", read: false,
      requirementIds: ["references"], expect: { status: "success", returns: [] } });
    const actual = await report(content, createGeneralCheckBlueprint(raw, intent, 999, "cancun"));
    expect(actual.passed).toBe(false); expect(actual.failures.some(failure => failure.code === "undeclared-deployment")).toBe(true);
  });
  it("rejects duplicate, forward or nonconsecutive child identities before executing", () => {
    for (const mutate of [
      (raw: ReturnType<typeof declaration>) => { raw.constructorChildren[1].id = "child"; },
      (raw: ReturnType<typeof declaration>) => { raw.constructorChildren[0].parent = "leaf"; },
      (raw: ReturnType<typeof declaration>) => { raw.constructorChildren[1].nonce = "2"; },
    ]) { const raw = declaration(); mutate(raw); expect(() => createGeneralCheckBlueprint(raw, intent, 999, "cancun")).toThrow(); }
  });
});
