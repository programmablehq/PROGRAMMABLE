export type SourceObservation = { status: "ready" | "blocked"; checkedAt: number; validUntil: number; evidenceHash: string };
export type WorkerHealth = Record<"feeds" | "prices" | "programs", SourceObservation>;
export function normalizeWorkerHealth(value: Partial<WorkerHealth>, now: number): WorkerHealth {
  const blocked: SourceObservation = {status:"blocked",checkedAt:now,validUntil:now,evidenceHash:""};
  const check = (source?: SourceObservation): SourceObservation => source && source.status === "ready"
    && Number.isSafeInteger(source.checkedAt) && Number.isSafeInteger(source.validUntil)
    && source.checkedAt <= now && now-source.checkedAt <= 180000 && source.validUntil > now
    && source.validUntil <= source.checkedAt+180000 && /^[a-f0-9]{64}$/.test(source.evidenceHash)
    ? source : blocked;
  return { feeds:check(value.feeds),prices:check(value.prices),programs:check(value.programs) };
}
