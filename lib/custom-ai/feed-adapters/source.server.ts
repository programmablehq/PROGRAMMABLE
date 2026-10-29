import "server-only";
import type { FeedSnapshot } from "../rule-evaluator";
import { readWeather, type WeatherFeedDefinition } from "./weather.server";
import { readMarketObservation, type MarketFeedDefinition } from "./market.server";
export type FeedDefinition=WeatherFeedDefinition|MarketFeedDefinition;
export function readFeedSource(definition:FeedDefinition,previous?:FeedSnapshot,signal?:AbortSignal){
  return definition.kind==="market"?readMarketObservation(definition,previous,signal):readWeather(definition,previous,signal);
}
