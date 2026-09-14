import { HookathonCountdown } from "@/components/hookathon-countdown";
import { PublicExternalLink } from "@/components/public-external-link";
import styles from "@/components/hookathon-page.module.css";
import { hookathonConfig } from "@/lib/hookathon/config";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type HookathonPageProps = Readonly<{
  initialNowMs: number;
}>;

export function HookathonPage({ initialNowMs }: HookathonPageProps) {
  return (
    <article
      className={`${styles.page} hookathon-root`}
      aria-labelledby="hookathon-title"
    >
      <div className={`${styles.shell} liquid-glass-surface`}>
        <header className={styles.hero}>
          <h1 id="hookathon-title">{hookathonConfig.name}</h1>
          <HookathonCountdown
            deadlineIso={hookathonConfig.deadlineIso}
            hookbuilderUrl={hookathonConfig.hookbuilderUrl}
            initialNowMs={initialNowMs}
          />
        </header>

        <section className={styles.prizes} aria-labelledby="hookathon-prizes">
          <div className={styles.prizeLead}>
            <h2 id="hookathon-prizes">Prize pool</h2>
            <p>{usdFormatter.format(hookathonConfig.totalPrizeUsd)}</p>
          </div>
          <ol className={styles.prizeSplit}>
            {hookathonConfig.prizes.map((prize) => (
              <li key={prize.place}>
                <span>{prize.place}</span>
                <strong>{usdFormatter.format(prize.amountUsd)}</strong>
              </li>
            ))}
          </ol>
        </section>

        <section
          className={styles.eligibility}
          aria-labelledby="hookathon-eligibility"
        >
          <h2 id="hookathon-eligibility">Eligibility</h2>
          <p>
            {hookathonConfig.eligibility.beforeSubmissionLink}{" "}
            <PublicExternalLink
              href={hookathonConfig.submissionUrl}
              rel="noreferrer"
              target="_blank"
            >
              {hookathonConfig.eligibility.submissionLinkLabel}
            </PublicExternalLink>
            {hookathonConfig.eligibility.afterSubmissionLink}
          </p>
        </section>

        <section className={styles.judging} aria-labelledby="hookathon-judging">
          <h2 id="hookathon-judging">Judging</h2>
          <ul aria-label="Judging criteria">
            {hookathonConfig.judging.criteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
          <p>{hookathonConfig.judging.description}</p>
        </section>
      </div>
    </article>
  );
}
