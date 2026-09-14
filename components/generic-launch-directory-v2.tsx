"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { GenericLaunchRecordV2 } from
  "@/lib/server/custom-launch/generic-launch-contract-v2";
import styles from "./generic-launch-directory-v2.module.css";

type FeedState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; records: readonly GenericLaunchRecordV2[] }>;

export function GenericLaunchDirectoryV2() {
  const [state, setState] = useState<FeedState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/custom-launch/generic/v2/launches?limit=24", {
      headers: { accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new TypeError("launch feed unavailable");
      const value = await response.json() as Readonly<{
        schemaVersion?: unknown;
        records?: unknown;
      }>;
      if (value.schemaVersion !== "programmable.generic-launch-feed.v2"
        || !Array.isArray(value.records)) throw new TypeError("launch feed invalid");
      setState({
        status: "ready",
        records: value.records as readonly GenericLaunchRecordV2[],
      });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: "error" });
      void error;
    });
    return () => controller.abort();
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Legacy Custom records</p>
        <h1>Registry launch history</h1>
        <p className={styles.intro}>
          These records come from the retired Registry approval flow. New
          Custom launches use the Custom Launch API.
        </p>
        <div className={styles.headerActions}>
          <Link href="/developers/api-keys">Manage API keys</Link>
          <Link href="/docs/developers/custom-launch">Read the API guide</Link>
        </div>
      </header>
      {state.status === "loading" ? (
        <div role="status">
          <span className={styles.srOnly}>Loading launch records…</span>
          <section aria-hidden="true" className={`${styles.grid} ${styles.skeletonGrid}`}>
            {Array.from({ length: 3 }, (_, index) => (
              <article className={`${styles.card} ${styles.skeletonCard}`} key={index}>
                <span className={`${styles.skeletonLine} ${styles.skeletonState}`} />
                <span className={`${styles.skeletonLine} ${styles.skeletonTitle}`} />
                <span className={`${styles.skeletonLine} ${styles.skeletonMeta}`} />
                <div className={styles.skeletonFacts}>
                  <span className={`${styles.skeletonLine} ${styles.skeletonFactLabel}`} />
                  <span className={`${styles.skeletonLine} ${styles.skeletonFactValue}`} />
                  <span className={`${styles.skeletonLine} ${styles.skeletonFactLabel}`} />
                  <span className={`${styles.skeletonLine} ${styles.skeletonFactValue}`} />
                </div>
                <span className={`${styles.skeletonLine} ${styles.skeletonLink}`} />
              </article>
            ))}
          </section>
        </div>
      ) : state.status === "error" ? (
        <p role="status" className={styles.status}>
          Registry records are unavailable right now.
        </p>
      ) : state.records.length === 0 ? (
        <p role="status" className={styles.status}>No finalized launches yet.</p>
      ) : (
        <section aria-label="Finalized custom launches" className={styles.grid}>
          {state.records.map((record) => (
            <LaunchCard key={record.recordHash} record={record} />
          ))}
        </section>
      )}
    </div>
  );
}

export function GenericLaunchDetailV2({ recordHash }: { recordHash: string }) {
  const [record, setRecord] = useState<GenericLaunchRecordV2 | null | undefined>();
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/custom-launch/generic/v2/launches/${encodeURIComponent(recordHash)}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new TypeError("launch unavailable");
      const value = await response.json() as Readonly<{
        schemaVersion?: unknown;
        record?: GenericLaunchRecordV2;
      }>;
      if (value.schemaVersion !== "programmable.generic-launch-view.v2"
        || value.record === undefined) throw new TypeError("launch invalid");
      setRecord(value.record);
    }).catch(() => {
      if (!controller.signal.aborted) setRecord(null);
    });
    return () => controller.abort();
  }, [recordHash]);
  if (record === undefined) {
    return <div className={styles.page}><p role="status" className={styles.status}>Loading launch…</p></div>;
  }
  if (record === null) {
    return <div className={styles.page}><p role="status" className={styles.status}>This launch record is unavailable.</p></div>;
  }
  const source = record.sourceProjection;
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/custom-launches">← Registry records</Link>
      <article className={styles.detail} aria-labelledby="launch-title">
        <p className={styles.eyebrow}>Legacy Registry launch</p>
        <h1 id="launch-title">{source.sourceRevision.repositoryFullName}</h1>
        <p className={styles.intro}>
          Registry approval {source.approval.approvalRevision} · source {short(source.sourceRevision.commitObjectId)}
        </p>
        <dl className={styles.facts}>
          <Fact label="Launch ID" value={source.descriptor.launchId} />
          <Fact label="Descriptor" value={source.descriptor.descriptorHash} />
          <Fact label="Launch wallet" value={source.descriptor.launchWallet} />
          <Fact label="Primary contract" value={source.descriptor.primaryContract} />
          <Fact label="Source tree" value={source.sourceRevision.treeObjectId} />
          <Fact label="Finalized block" value={source.lifecycle.finalization.blockNumber} />
          <Fact label="Common verified head" value={source.lifecycle.latestCommonHead} />
          <Fact label="Record hash" value={record.recordHash} />
        </dl>
        <div className={styles.actions}>
          <a href={`https://etherscan.io/address/${source.descriptor.primaryContract}`} target="_blank" rel="noreferrer">
            View contract<span className={styles.srOnly}> on Etherscan</span>
          </a>
          <Link href="/developers/api-keys">Manage API keys</Link>
        </div>
      </article>
    </div>
  );
}

function LaunchCard({ record }: { record: GenericLaunchRecordV2 }) {
  const source = record.sourceProjection;
  return (
    <article className={styles.card}>
      <p className={styles.cardState}>Finalized · non-revoked</p>
      <h2>{source.sourceRevision.repositoryFullName}</h2>
      <p>Revision {source.approval.approvalRevision} · {short(source.sourceRevision.commitObjectId)}</p>
      <dl className={styles.cardFacts}>
        <Fact label="Launch ID" value={short(source.descriptor.launchId)} />
        <Fact label="Wallet" value={short(source.descriptor.launchWallet)} />
      </dl>
      <Link className={styles.cardLink} href={`/custom-launches/${record.recordHash}`}>
        View verified launch<span aria-hidden="true"> ↗</span>
      </Link>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd title={value}>{value}</dd></div>;
}

function short(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}
