export type AutomaticLaunchTransport = {
  schemaVersion:"programmable.automatic-launch-transport.v1";
  reviewId:string;resourceId:string;chainId:"1"|"4663"|"8453"|"999"|"99901";controller:string;
  subjectHash:`sha256:${string}`;originalRequestHash:`sha256:${string}`;requestHash:`sha256:${string}`;
  rawRequestSha256:`sha256:${string}`|null;deadline:string;checkedAt:string;
  currentStatus:Record<string,unknown>;
};
export type AutomaticReviewView = {
  schemaVersion:"programmable.automatic-launch-status.v1";reviewId:string;
  state:"not_started"|"checking"|"approved"|"changes_required"|"interrupted";
  manualReviewRequired:false;launchReady:false;
  findings:{code:string;message:string}[];
  timing:{sourceGeneratedAt:number;startedAt:number;finishedAt:number|null;sourceToDecisionMs:number|null;decisionWithinTarget:boolean|null}|null;
  configuration?:{productionHash:`sha256:${string}`;verifierRevision:`sha256:${string}`};
  transport?:AutomaticLaunchTransport|null;
};
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==="object"&&!Array.isArray(v);
const hash=(v:unknown):v is `sha256:${string}`=>typeof v==="string"&&/^sha256:[a-f0-9]{64}$/u.test(v);
const id=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(v);
const bad=():never=>{throw Error("The automatic check could not be matched to this saved launch.");};
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));

/** This proof originates in the authenticated backend. It binds a refreshed
 * transport hash to the exact original submission, rather than accepting any
 * new hash merely because its wallet or resource ID matches. */
export function readAutomaticTransport(value:unknown,binding:{reviewId?:string;resourceId:string;chainId:number;account:string;
  originalRequestHash:string;subjectHash?:string},now=Date.now()):AutomaticLaunchTransport {
  if(!object(value)||!keys(value,["schemaVersion","reviewId","resourceId","chainId","controller","subjectHash","originalRequestHash","requestHash","rawRequestSha256","deadline","checkedAt","currentStatus"])
    ||value.schemaVersion!=="programmable.automatic-launch-transport.v1"||!id(value.reviewId)||binding.reviewId&&value.reviewId!==binding.reviewId
    ||value.resourceId!==binding.resourceId||value.chainId!==String(binding.chainId)||typeof value.controller!=="string"
    ||value.controller.toLowerCase()!==binding.account.toLowerCase()||!hash(value.subjectHash)||binding.subjectHash&&value.subjectHash!==binding.subjectHash
    ||value.originalRequestHash!==binding.originalRequestHash||!hash(value.originalRequestHash)||!hash(value.requestHash)
    ||(binding.chainId===4663?!hash(value.rawRequestSha256):value.rawRequestSha256!==null)
    ||typeof value.deadline!=="string"||!/^[1-9][0-9]{0,19}$/u.test(value.deadline)||BigInt(value.deadline)>=2n**64n
    ||typeof value.checkedAt!=="string"||!Number.isFinite(Date.parse(value.checkedAt))||new Date(value.checkedAt).toISOString()!==value.checkedAt
    ||Math.abs(now-Date.parse(value.checkedAt))>30_000)return bad();
  const status=value.currentStatus;
  if(!object(status)||!keys(status,["schemaVersion","kind","chainId","resourceId","controller","requestHash","rawRequestSha256","status","errorCode","createdAt","updatedAt","checkedAt","deadline","launchReady"])
    ||status.schemaVersion!=="programmable.wallet-launch-status.v1"||status.kind!==(binding.chainId===4663?"plan-v1":"graph-v3")
    ||status.chainId!==value.chainId||status.resourceId!==value.resourceId||status.controller!==value.controller
    ||status.requestHash!==value.requestHash||status.rawRequestSha256!==value.rawRequestSha256||status.deadline!==value.deadline
    ||status.checkedAt!==value.checkedAt||status.launchReady!==false)return bad();
  return structuredClone(value) as AutomaticLaunchTransport;
}

export function readAutomaticReview(value:unknown,reviewId?:string):AutomaticReviewView {
  if(!object(value)||!keys(value,["schemaVersion","reviewId","state","manualReviewRequired","launchReady","findings","timing","configuration","transport"])
    ||value.schemaVersion!=="programmable.automatic-launch-status.v1"||!id(value.reviewId)||reviewId&&value.reviewId!==reviewId
    ||!["not_started","checking","approved","changes_required","interrupted"].includes(String(value.state))
    ||value.manualReviewRequired!==false||value.launchReady!==false||!Array.isArray(value.findings)||value.findings.length>32
    ||value.findings.some(f=>!object(f)||!keys(f,["code","message"])||typeof f.code!=="string"||!/^[A-Z][A-Z0-9_]{0,95}$/u.test(f.code)
      ||typeof f.message!=="string"||!f.message.trim()||f.message.length>1000))return bad();
  if(value.configuration!==undefined&&(!object(value.configuration)||!keys(value.configuration,["productionHash","verifierRevision"])
    ||!hash(value.configuration.productionHash)||!hash(value.configuration.verifierRevision)))return bad();
  const t=value.timing;
  if(t!==null){
    if(!object(t)||!keys(t,["sourceGeneratedAt","startedAt","finishedAt","sourceToDecisionMs","decisionWithinTarget"])
      ||!Number.isSafeInteger(t.sourceGeneratedAt)||Number(t.sourceGeneratedAt)<0||!Number.isSafeInteger(t.startedAt)||Number(t.startedAt)<Number(t.sourceGeneratedAt)
      ||(value.state==="checking"?t.finishedAt!==null||t.sourceToDecisionMs!==null||t.decisionWithinTarget!==null:
        !Number.isSafeInteger(t.finishedAt)||Number(t.finishedAt)<Number(t.startedAt)||t.sourceToDecisionMs!==Number(t.finishedAt)-Number(t.sourceGeneratedAt)
        ||t.decisionWithinTarget!==(value.state==="approved"&&Number(t.sourceToDecisionMs)<=60_000)))return bad();
  }else if(value.state!=="not_started")return bad();
  if(value.transport!==undefined&&value.transport!==null&&!object(value.transport))return bad();
  if(value.transport&&value.state!=="approved")return bad();
  return structuredClone(value) as AutomaticReviewView;
}
