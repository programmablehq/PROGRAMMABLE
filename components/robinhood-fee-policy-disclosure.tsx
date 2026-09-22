import styles from "@/components/robinhood-fee-policy-disclosure.module.css";

export function RobinhoodFeePolicyDisclosure() {
  return (
    <details
      className={styles.policyDisclosure}
      aria-labelledby="robinhood-fee-policy-title"
    >
      <summary>
        <span id="robinhood-fee-policy-title">Robinhood fee policy</span>
        <span>0.20%</span>
      </summary>
      <p>
        Programmable policy for new Robinhood V4 API Custom launch requests is
        0.20% (2,000 ppm), recipient{" "}
        <code>0xD88539d3c4C460136a733A3Fd60cf6BF269079da</code>. Existing
        launches are unchanged.
      </p>
      <p>
        The current V4 runtime does not claim immutable onchain fee
        enforcement, fee behavior, claiming, or guaranteed revenue. The
        Launch Stamp proves provenance only.
      </p>
    </details>
  );
}
