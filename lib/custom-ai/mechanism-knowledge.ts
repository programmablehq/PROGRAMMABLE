import type { LaunchIntent } from "./launch-intent";
import { PROTOCOL_TOPICS, type ProtocolTopic } from "./protocol-knowledge";
import { productDesignKnowledge } from "./product/design-knowledge";

/** The fixed fee module can quote rates and fund its own actions, but cannot
 * implement an arbitrary token purchase followed by a burn. Start that clear
 * request on the general route instead of asking for both incompatible forms. */
export function requiresCustomFeeContract(message:string):boolean {
  return /\b(?:buy[ -]?back|buying back)\s*(?:(?:and(?: then)?|&|und|then)\s*)?burn(?:ing)?\b/iu.test(message)
    && !/\b(?:no|without|don't|do not|kein(?:en)?|ohne)\s+(?:buy[ -]?back|buying back)\s*(?:(?:and(?: then)?|&|und|then)\s*)?burn(?:ing)?\b/iu.test(message);
}

/** Select reviewed guidance, not facts or instructions from the design text. */
export function mechanismTopics(intent?: Pick<LaunchIntent, "requirements">, message = "") {
  const text = [message, ...(intent?.requirements.map(rule => rule.text) ?? [])].join(" ").toLowerCase();
  const topics: ProtocolTopic[] = [];
  if (/liquidit|liquidity|buyback|buy.?back|burn|holder|geb[uü]hr.*(?:teil|verteil)|fee.*(?:split|allocat|distribut)|project.?fees|projektfees|projektgeb[uü]hr|fees?.{0,100}(?:wallet|creator|recipient)|geb[uü]hren?.{0,100}(?:wallet|creator|empf[aä]nger)|reinvest|dividend/.test(text)) topics.push("fee-flows");
  if (/\bapi\b|oracle|weather|wetter|perpetual|funding rate|signed.*(?:feed|data)|datenquelle|external.*(?:data|event)|webhook/.test(text)) topics.push("integrations");
  if (/timer|countdown|schedule|epoch|snapshot|\btwap\b|weather|wetter|oracle|keeper|zeitgesteuert|stunden|täglich|taeglich|cross.?chain|random|zufall|\bvrf\b/.test(text)) topics.push("external-data");
  if (/\brouter\b|routing|hookdata|payer|exact.?input|exact.?output|universal.?router|swap.?route/.test(text)) topics.push("routing");
  if (/callback|before.?swap|after.?swap|before.?initialize|after.?initialize|reentr|poolmanager/.test(text)) topics.push("callbacks");
  if (/custom.?curve|bonding.?curve|rebate|refund|rückerstattung|rueckerstattung|inventory|auction|auktion|\bjit\b|delta|settlement/.test(text)) topics.push("accounting");
  if (/custom|arbitrary|unconventional|creative|kreativ|combine|kombin|vesting|auction|auktion|\btwamm\b|\bdca\b|limit.?order|limit.?auftrag|game|spiel|ponzi|counter|zähler|zaehler|vault|rebalanc|versicher|insurance|loyalty|treue|meilenstein|milestone/.test(text)
    || !topics.length && intent?.requirements.some(rule => rule.kind === "behavior")) topics.push("composition");
  return topics;
}

export function mechanismKnowledge(intent?: Pick<LaunchIntent, "requirements">, message = "") {
  return [...mechanismTopics(intent,message).map(topic => `${PROTOCOL_TOPICS[topic].title}: ${PROTOCOL_TOPICS[topic].facts}`),productDesignKnowledge(intent,message)].filter(Boolean).join("\n");
}
