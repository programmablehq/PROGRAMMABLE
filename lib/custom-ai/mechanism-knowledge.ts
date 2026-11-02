import type { LaunchIntent } from "./launch-intent";
import { PROTOCOL_TOPICS } from "./protocol-knowledge";

/** Select reviewed guidance, not facts or instructions from the design text. */
export function mechanismTopics(intent?: Pick<LaunchIntent, "requirements">, message = "") {
  const text = [message, ...(intent?.requirements.map(rule => rule.text) ?? [])].join(" ").toLowerCase();
  const topics: ("fee-flows" | "integrations")[] = [];
  if (/liquidit|liquidity|buyback|buy.?back|burn|holder|geb[uü]hr.*(?:teil|verteil)|fee.*(?:split|allocat|distribut)|reinvest|dividend/.test(text)) topics.push("fee-flows");
  if (/\bapi\b|oracle|weather|wetter|perpetual|funding rate|signed.*(?:feed|data)|datenquelle|external.*(?:data|event)|webhook/.test(text)) topics.push("integrations");
  return topics;
}

export function mechanismKnowledge(intent?: Pick<LaunchIntent, "requirements">, message = "") {
  return mechanismTopics(intent,message).map(topic => `${PROTOCOL_TOPICS[topic].title}: ${PROTOCOL_TOPICS[topic].facts}`).join("\n");
}
