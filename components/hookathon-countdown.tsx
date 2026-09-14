"use client";

import { useEffect, useState } from "react";
import { isGitHubUrl } from "@/lib/public-link-visibility";

import styles from "@/components/hookathon-countdown.module.css";
import {
  getHookathonCountdown,
  type HookathonCountdownParts,
} from "@/lib/hookathon/time";

export type HookathonCountdownProps = Readonly<{
  deadlineIso: string;
  hookbuilderUrl: string;
  initialNowMs: number;
}>;

const COUNTDOWN_UNITS = [
  { key: "days", label: "Days" },
  { key: "hours", label: "Hours" },
  { key: "minutes", label: "Minutes" },
  { key: "seconds", label: "Seconds" },
] as const satisfies ReadonlyArray<{
  key: keyof Pick<
    HookathonCountdownParts,
    "days" | "hours" | "minutes" | "seconds"
  >;
  label: string;
}>;

function paddedUnit(value: number) {
  return String(value).padStart(2, "0");
}

export function HookathonCountdown({
  deadlineIso,
  hookbuilderUrl,
  initialNowMs,
}: HookathonCountdownProps) {
  const deadlineMs = Date.parse(deadlineIso);
  const [countdown, setCountdown] = useState(() =>
    getHookathonCountdown(deadlineMs, initialNowMs),
  );

  useEffect(() => {
    const monotonicStartMs = performance.now();
    let tickTimeout: number | undefined;

    const currentServerBoundTime = () =>
      initialNowMs + Math.max(0, performance.now() - monotonicStartMs);

    const clearTick = () => {
      if (tickTimeout === undefined) return;
      window.clearTimeout(tickTimeout);
      tickTimeout = undefined;
    };

    const syncCountdown = () => {
      clearTick();
      const next = getHookathonCountdown(
        deadlineMs,
        currentServerBoundTime(),
      );

      setCountdown((current) =>
        current.totalSeconds === next.totalSeconds &&
        current.ended === next.ended
          ? current
          : next,
      );

      if (next.ended || document.hidden) return;

      const nextBoundary = next.totalMilliseconds % 1_000;
      const delay = nextBoundary === 0 ? 1_000 : Math.max(50, nextBoundary);
      tickTimeout = window.setTimeout(syncCountdown, delay);
    };

    const syncVisibility = () => {
      clearTick();
      if (!document.hidden) syncCountdown();
    };

    syncCountdown();
    document.addEventListener("visibilitychange", syncVisibility);

    return () => {
      clearTick();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [deadlineMs, initialNowMs]);

  return (
    <div
      className={styles.island}
      data-state={countdown.ended ? "ended" : "running"}
    >
      <div className={styles.timerFrame}>
        {countdown.ended ? (
          <p className={styles.closed} aria-hidden="true">
            Submissions closed
          </p>
        ) : (
          <dl className={styles.timer} aria-hidden="true">
            {COUNTDOWN_UNITS.map((unit) => (
              <div className={styles.unit} key={unit.key}>
                <dd>{paddedUnit(countdown[unit.key])}</dd>
                <dt>{unit.label}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>

      <p className="sr-only">
        {countdown.ended
          ? "Submissions closed"
          : `${countdown.days} days, ${countdown.hours} hours, ${countdown.minutes} minutes and ${countdown.seconds} seconds remaining`}
      </p>

      {countdown.ended || !isGitHubUrl(hookbuilderUrl) ? (
        <div className={styles.actions}>
          {countdown.ended ? (
            <span className={styles.closedAction} aria-disabled="true">
              Submissions closed
            </span>
          ) : (
            <a
              className={styles.secondaryAction}
              href={hookbuilderUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open Hookbuilder
            </a>
          )}
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {countdown.ended ? "Submissions closed" : ""}
      </p>
    </div>
  );
}
