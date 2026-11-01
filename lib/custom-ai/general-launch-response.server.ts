import "server-only";
import type { BackendLaunchReply } from "./backend-launch.server";
import type { GeneralExchangeOperation, GeneralExchangeSummary, GeneralPreparation } from "./general-preparation-store.server";
import { CustomAIError } from "./types";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";

const object = (value: unknown): Record<string,unknown> | null => value!==null && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : null;
const invalid = (): never => {throw new CustomAIError("launch-response-binding","The launch response could not be matched to your saved request. Check the original preparation before continuing.",503);};
const codes = (value: unknown,maximum=256): string[] => {
  if(!Array.isArray(value)||value.length>maximum||value.some(code=>typeof code!=="string"||!/^[A-Z][A-Z0-9_]{0,127}$/u.test(code)))return invalid();
  return [...new Set(value as string[])];
};
const id = (value: unknown) => typeof value==="string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);

/** Same V3 response facts used by the canonical SDK. This projection carries
 * the backend's disposition/status and never turns it into launch readiness. */
export function projectGeneralGraphReply(operation: GeneralExchangeOperation,reply: BackendLaunchReply,record: GeneralPreparation): GeneralExchangeSummary {
  const value=object(reply.value);
  if(!value || value.requestHash!==record.requestHash || record.chainId===4663)return invalid();
  if(operation==="preflight") {
    const eligibility=object(value.launchEligibility);
    if(reply.httpStatus!==200 || reply.location!==null || value.schemaVersion!=="programmable.custom-launch-preflight.v1"
      || value.profileRevision!==3 || typeof value.serverTime!=="string" || !Number.isFinite(Date.parse(value.serverTime))
      || !["supported","supported_with_warnings","needs_evidence","unsupported"].includes(String(value.disposition))
      || !eligibility || ["deployable","routable","featured"].some(key=>typeof eligibility[key]!=="boolean")
      || value.quotaConsumed!==false || value.nonceAllocated!==false || value.persisted!==false
      || value.walletSignatureRequiredLater!==true || value.walletBroadcastByService!==false)return invalid();
    const hard=codes(value.hardBlockFindingCodes), needs=codes(value.needsEvidenceFindingCodes), warnings=codes(value.warningFindingCodes);
    return {httpStatus:200,disposition:hard.length?"unsupported":String(value.disposition),findingCodes:[...new Set([...hard,...needs,...warnings])].slice(0,64)};
  }
  const statuses=["received","validating","prepared","simulating","authorized","submitted","finalized","failed","cancelled",
    "pending_review","action_required","awaiting_funding_authorization","funding_authorization_verified"];
  if(![200,202].includes(reply.httpStatus) || value.schemaVersion!=="programmable.custom-launch.v3"
    || !id(value.launchId)||!id(value.requestId)||typeof value.ownerWallet!=="string"||value.ownerWallet.toLowerCase()!==record.account.toLowerCase()
    || value.routeId!=="custom-launch:create:v3"||value.launchProfileVersion!=="3.6.0"
    || value.launchProfileHash!==record.launchProfileHash || value.launchIntentHash!==record.launchIntentHash
    || !statuses.includes(String(value.status)) || !reply.location
    || new URL(reply.location,"https://api.programmable.market").pathname.split("/").at(-1)!==value.launchId)return invalid();
  return {httpStatus:reply.httpStatus,resourceId:String(value.launchId),backendState:String(value.status)};
}

/** Modern Robinhood responses retain their own Plan/raw-body/manifest domains.
 * A normal accepted review resource is not an issuer or wallet authorization. */
export function projectGeneralPlanReply(operation:GeneralExchangeOperation,reply:BackendLaunchReply,record:GeneralPreparation):GeneralExchangeSummary {
  const value=object(reply.value);
  if(!value||record.chainId!==4663||!record.manifestDigest||value.planHash!==record.requestHash||value.manifestDigest!==record.manifestDigest)return invalid();
  if(operation==="preflight"){
    const eligibility=object(value.launchEligibility);
    if(reply.httpStatus!==200||reply.location!==null||value.schemaVersion!=="programmable.custom-launch-plan-preflight.v1"||!id(value.requestId)
      ||!eligibility||!["ready","action_required","analysis_pending"].includes(String(eligibility.status))
      ||!Array.isArray(eligibility.hardBlockers)||!Array.isArray(value.findings)||value.findings.length>2048||eligibility.hardBlockers.length>2048)return invalid();
    const findings=codes(value.findings.map(item=>object(item)?.code),2048),hard=codes(eligibility.hardBlockers.map(item=>object(item)?.code),2048);
    return {httpStatus:200,disposition:hard.length?"unsupported":eligibility.status==="ready"?"supported":"needs_evidence",
      findingCodes:[...new Set([...hard,...findings])].slice(0,64)};
  }
  const plan=object(value.plan),controller=object(plan?.controller),window=object(plan?.budgets);
  const statuses=["accepted","preflight_complete","launch_ready","action_required","analysis_pending","reserved","wallet_action_ready",
    "broadcast","mined","final","source_verified","indexed","publicly_visible","expired"];
  if(![200,202].includes(reply.httpStatus)||value.schemaVersion!=="programmable.custom-launch-plan-resource.v1"||!id(value.planId)||!id(value.requestId)
    ||value.rawRequestSha256!==record.requestSha256||!plan||plan.schemaVersion!=="programmable.custom-launch-plan.v1"||plan.chainId!=="4663"
    ||plan.manifestDigest!==record.manifestDigest||plan.executor!=="atomic_execute_and_stamp_v2"||!controller||typeof controller.address!=="string"
    ||controller.address.toLowerCase()!==record.account.toLowerCase()||controller.kind!==record.controllerKind
    ||!window||window.validAfter!==record.identity.validAfter||window.deadline!==record.identity.deadline
    ||canonicalBrowserSha256V2("programmable.custom-launch-plan.v1",plan)!==record.requestHash||!statuses.includes(String(value.status))
    ||!reply.location||new URL(reply.location,"https://api.programmable.market").pathname.split("/").at(-1)!==value.planId)return invalid();
  return {httpStatus:reply.httpStatus,resourceId:String(value.planId),backendState:String(value.status)};
}
