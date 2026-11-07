import "server-only";
import type { AIConnection, AIBudget } from "./store.server";
import { CustomAIError } from "./types";

export async function reserveAIUnits(db: AIConnection, owner: string, units: number, limits: AIBudget, time: number) {
  if (!Number.isSafeInteger(units) || units < 1 || units > 10_000) throw new CustomAIError("input", "Invalid work allowance.");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["custom-ai-budget-v1"]);
  const hour = Math.floor(time / 3_600_000), day = Math.floor(time / 86_400_000);
  for (const [subject, period, limit] of [
    [`account-hour:${owner}`, hour, limits.hourlyUnits], [`account-day:${owner}`, day, limits.dailyUnits], ["global-day", day, limits.globalDailyUnits],
  ] as const) {
    const row = await db.query(`INSERT INTO programmable_custom_ai_v1.budgets(subject,period,used)
      VALUES($1,$2,$3) ON CONFLICT(subject,period) DO UPDATE SET used=programmable_custom_ai_v1.budgets.used+$3
      WHERE programmable_custom_ai_v1.budgets.used+$3 <= $4 RETURNING used`, [subject, period, units, limit]);
    if (units > limit || !row.rows.length) {
      const duration = subject.startsWith("account-hour:") ? 3_600_000 : 86_400_000;
      throw new CustomAIError("budget", "The current allowance is used up. Your project is saved.", 429, (period + 1) * duration - time);
    }
  }
  return { hour, day };
}

export async function refundAIUnits(db: AIConnection, owner: string, units: number, hour: number, day: number) {
  if (!Number.isSafeInteger(units) || units < 0) throw new CustomAIError("budget-state", "The saved work allowance needs reconciliation.", 503);
  if (!units) return;
  for (const [subject, period] of [[`account-hour:${owner}`, hour], [`account-day:${owner}`, day], ["global-day", day]] as const) {
    const row = await db.query("UPDATE programmable_custom_ai_v1.budgets SET used=used-$3 WHERE subject=$1 AND period=$2 AND used>=$3 RETURNING used", [subject, period, units]);
    if (row.rows.length !== 1) throw new CustomAIError("budget-state", "The saved work allowance needs reconciliation.", 503);
  }
}
