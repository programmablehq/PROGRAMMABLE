import "server-only";
import type { FeedSnapshot } from "../rule-evaluator";
import { readWeather, type WeatherFeedDefinition } from "./weather.server";
import { readMarketObservation, type MarketFeedDefinition } from "./market.server";
import { readJSONObservation, type JSONDataAdapter } from "./json.server";
export type JSONFeedDefinition={kind:"json";id:string;sourceVersion:string;maxAgeSeconds:number;adapter:JSONDataAdapter};
export type FeedDefinition=WeatherFeedDefinition|MarketFeedDefinition|JSONFeedDefinition;
export function readFeedSource(definition:FeedDefinition,previous?:FeedSnapshot,signal?:AbortSignal){
  if(definition.kind==="json"){
    if(definition.id!==definition.adapter.id||definition.sourceVersion!==definition.adapter.implementationHash||definition.maxAgeSeconds!==definition.adapter.definition.maxAgeSeconds)throw Error("Data adapter binding changed");
    return readJSONObservation(definition.adapter,previous,signal).then(result=>result.observation);
  }
  return definition.kind==="market"?readMarketObservation(definition,previous,signal):readWeather(definition,previous,signal);
}
