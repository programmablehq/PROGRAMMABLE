"use client";

import { Search } from "lucide-react";

import { ExploreFilters } from "@/components/explore-filters";
import styles from "@/components/index-reset-view.module.css";

export function ExploreIndexResetView({
  embedded = false,
}: Readonly<{ embedded?: boolean }>) {
  const Heading = embedded ? "h2" : "h1";

  return (
    <div
      className={`${styles.explorePage} ${
        embedded ? styles.embeddedExplore : ""
      } explore-page page-width`}
    >
      <header className={styles.exploreHeading}>
        <Heading data-explore-heading>Explore</Heading>
      </header>

      <section
        className={styles.exploreBody}
        aria-labelledby="index-reset-title"
      >
        {!embedded ? (
          <div className={styles.toolbar} aria-label="Explore controls">
            <div className={styles.disabledSearch} role="search">
              <Search aria-hidden="true" size={17} />
              <label className="sr-only" htmlFor="explore-token-search">
                Search launches by name, ticker or contract address
              </label>
              <input
                id="explore-token-search"
                type="search"
                placeholder="Name, symbol or address"
                disabled
              />
            </div>

            <ExploreFilters disabled />
          </div>
        ) : null}

        <div className={styles.resetState} role="status">
          <span className={styles.resetLabel}>Index reset</span>
          <div className={styles.resetCopy}>
            <h2 id="index-reset-title">Launch indexing is being rebuilt</h2>
            <p>No token data is loaded while we build the new index.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
