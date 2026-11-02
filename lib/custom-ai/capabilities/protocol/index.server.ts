import "server-only";
import { defineTool } from "../definition.server";
import { PROTOCOL_TOPICS, PROTOCOL_KNOWLEDGE_VERSION, type ProtocolTopic } from "../../protocol-knowledge";

export default defineTool("protocol", "Read reviewed local Uniswap v4 design knowledge: callback permissions, router compatibility, accounting, external data, creative composition or verification limits. No network or model call. This explains mechanics, not current deployment availability.", async (input, context) => {
  context.signal?.throwIfAborted();
  const { topic } = input as { topic: ProtocolTopic }, entry = PROTOCOL_TOPICS[topic];
  return { status: "reviewed-protocol-knowledge", facts: { version: PROTOCOL_KNOWLEDGE_VERSION, topic, ...entry,
    chainId: context.chainId, boundary: "Use current chain discovery and pinned source for exact deployments and ABIs." },
    sources: [{ title: entry.title, url: entry.source, retrievedAt: "2026-11-02T00:00:00Z" }] };
}, () => true, { type: "object", properties: { topic: { enum: Object.keys(PROTOCOL_TOPICS) } }, required: ["topic"], additionalProperties: false });
