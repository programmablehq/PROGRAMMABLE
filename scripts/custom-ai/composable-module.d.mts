import type { RuleSpecV2 } from "../../lib/custom-ai/rule-spec";
import type { RuleFeedBinding, BoundRuleSpec } from "../../lib/custom-ai/rule-compiler.server";
export function ruleSpecHash(spec: RuleSpecV2): string;
export function composableModuleSource(spec: RuleSpecV2, feeds: RuleFeedBinding[]): string;
export function seedComposableFeeds(requireTool: unknown, vm: unknown, binding: BoundRuleSpec, timestamp: bigint, snapshots?: unknown[]): Promise<void>;
