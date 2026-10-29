import "server-only";
import type { FeedSnapshot } from "../rule-evaluator";
export type WeatherFeedDefinition = { id: string; sourceVersion: string; latitude: number; longitude: number;
  kind: "model" | "observation"; unit: "mm"; maxAgeSeconds: number; sourceUrl: string; endpoint: string };
export const LONDON_RAIN: WeatherFeedDefinition = { id: "london-rain-v1", sourceVersion: "open-meteo-model-rain-v1",
  latitude: 51.5074, longitude: -0.1278, kind: "model", unit: "mm", maxAgeSeconds: 1800,
  sourceUrl: "https://open-meteo.com/en/docs", endpoint: "https://api.open-meteo.com/v1/forecast" };
export function normalizeWeather(raw: unknown, definition: WeatherFeedDefinition, now: number, previous?: FeedSnapshot): FeedSnapshot {
  const data = raw as { latitude?: number; longitude?: number; current_units?: { rain?: string; time?: string }; current?: { time?: number; rain?: number } };
  if (typeof data.latitude !== "number" || typeof data.longitude !== "number" || Math.abs(data.latitude - definition.latitude) > 0.1
    || Math.abs(data.longitude - definition.longitude) > 0.1 || data.current_units?.rain !== definition.unit || data.current_units?.time !== "unixtime"
    || !Number.isSafeInteger(data.current?.time) || typeof data.current?.rain !== "number" || !Number.isFinite(data.current.rain)
    || data.current.rain < 0 || data.current.rain > 1000) throw Error("Weather source returned incompatible observations");
  const observedAt = data.current.time!;
  if (observedAt > now || now - observedAt > definition.maxAgeSeconds || previous && (previous.sourceVersion !== definition.sourceVersion
    || previous.feedId !== definition.id || observedAt < previous.observedAt)) throw Error("Weather source is not current");
  const value = String(Math.round(data.current.rain * 1000));
  if (previous && observedAt === previous.observedAt) {
    if (previous.value !== value) throw Error("Weather observation conflicts with its original value");
    return previous;
  }
  const changed = Boolean(previous && previous.value !== value);
  return { feedId: definition.id, sourceVersion: definition.sourceVersion,
    sequence: String(BigInt(previous?.sequence ?? "0") + 1n), transitionSequence: String(BigInt(previous?.transitionSequence ?? "0") + (changed ? 1n : 0n)),
    value, previousValue: changed ? previous!.value : previous?.previousValue ?? value,
    changedAt: changed ? observedAt : previous?.changedAt ?? 0, observedAt, validUntil: observedAt + definition.maxAgeSeconds, fresh: true };
}
export async function readWeather(definition: WeatherFeedDefinition, previous?: FeedSnapshot, signal?: AbortSignal) {
  const url = new URL(definition.endpoint);
  if (url.protocol !== "https:" || url.username || url.password || !["api.open-meteo.com", "customer-api.open-meteo.com"].includes(url.hostname)) throw Error("Unapproved weather endpoint");
  url.search = new URLSearchParams({ latitude: String(definition.latitude), longitude: String(definition.longitude), current: "rain", timeformat: "unixtime", timezone: "UTC" }).toString();
  // A commercial provider key, if configured, stays exclusively in this adapter.
  if (url.hostname === "customer-api.open-meteo.com") {
    if (!process.env.CUSTOM_AI_WEATHER_API_KEY) throw Error("Weather provider is not configured");
    url.searchParams.set("apikey", process.env.CUSTOM_AI_WEATHER_API_KEY);
  }
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]) });
  if (!response.ok) { await response.body?.cancel(); throw Error("Weather provider is unavailable"); }
  const reader = response.body?.getReader(); if (!reader) throw Error("Weather observation is missing");
  let body = ""; const decoder = new TextDecoder();
  try { while (true) { const { done, value } = await reader.read(); if (done) break; body += decoder.decode(value, { stream: true }); if (body.length > 32000) throw Error("Weather observation is too large"); } }
  finally { await reader.cancel().catch(() => undefined); }
  return normalizeWeather(JSON.parse(body), definition, Math.floor(Date.now() / 1000), previous);
}
