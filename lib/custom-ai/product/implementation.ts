import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";

export type ProductImplementation = {
  version: 1; id: `sha256:${string}`; productBlueprintId: `sha256:${string}`; projectHash: `sha256:${string}`;
  artifactHash: `sha256:${string}`; checkBlueprintId: `sha256:${string}`; intentRevision: string;
  evidence: "compiled-interface" | "declared-scenarios-passed"; deployed: false;
  components: { id: string; fixture: string; source: string; contract: string }[];
  actions: { id: string; target: string; fixture: string; signature: string; mutability: "pure" | "view" | "nonpayable" | "payable" }[];
};
type Identity = Pick<ProductImplementation, "productBlueprintId" | "projectHash" | "artifactHash" | "intentRevision">;
const identityKeys=["productBlueprintId","projectHash","artifactHash","intentRevision"] as const;
const keys=(value:unknown,expected:string[])=>Boolean(value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).sort().join()===expected.sort().join());

export function cachedProductImplementation(value: unknown, expected: Identity): ProductImplementation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as ProductImplementation;
  const hash = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  const id = (value: unknown) => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  if (!keys(v,["version","id","productBlueprintId","projectHash","artifactHash","checkBlueprintId","intentRevision","evidence","deployed","components","actions"])
    ||v.version !== 1 || v.deployed !== false || !hash(v.id) || !hash(v.checkBlueprintId)
    || identityKeys.some(key=>v[key]!==expected[key])
    || !["compiled-interface", "declared-scenarios-passed"].includes(v.evidence)
    || !Array.isArray(v.components) || v.components.length > 64 || !Array.isArray(v.actions) || v.actions.length > 64
    || JSON.stringify(v).length > 64_000
    || v.components.some(item => !keys(item,["id","fixture","source","contract"]) || !id(item.id) || !id(item.fixture) || typeof item.source !== "string" || item.source.length > 180
      || typeof item.contract !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(item.contract))
    || new Set(v.components.map(item => item.id)).size !== v.components.length
    || v.actions.some(item => !keys(item,["id","target","fixture","signature","mutability"]) || !id(item.id) || !id(item.target) || !id(item.fixture) || typeof item.signature !== "string" || item.signature.length > 800
      || !["pure", "view", "nonpayable", "payable"].includes(item.mutability) || !v.components.some(component => component.id === item.target && component.fixture === item.fixture))
    || new Set(v.actions.map(item => item.id)).size !== v.actions.length) return;
  const { id: identity, ...body } = v;
  if (canonicalBrowserSha256V2("programmable.product-implementation.v1", body) !== identity) return;
  return structuredClone(v);
}
