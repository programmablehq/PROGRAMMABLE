import "server-only";
import {productionAIPool} from "../store.server";
import {productionPlatformStore} from "./production.server";
import {createGameEventStore} from "./event-store.server";
import {createGameEventService} from "./event-chain.server";
export const productionGameEvents=()=>createGameEventStore(productionAIPool(),productionPlatformStore());
export const productionGameEventService=()=>createGameEventService(productionGameEvents());
