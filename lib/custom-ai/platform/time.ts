import { ProjectError } from "./types";

/** PostgreSQL clients return either Date objects or ISO strings. String(Date)
 * discards fractional seconds and must not be used for lease comparisons. */
export function projectDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new ProjectError("project-time", "A stored timestamp needs reconciliation.", 503);
  return date;
}
