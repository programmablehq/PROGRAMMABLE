/** The API's execution state takes precedence over the review that permitted the launch. */
export function launchExecutionProgress(status: string) {
  switch (status) {
    case "submitted":
    case "broadcast":
    case "sequencer_soft_confirmed":
    case "ethereum_posted":
      return { complete: false, status: "Confirming", next: "Confirmation is tracked automatically" };
    case "mined":
      return { complete: false, status: "Confirming", next: "Waiting for finality" };
    case "final":
    case "finalized":
    case "publicly_visible":
      return { complete: true, status: "Completed", next: "Launch completed" };
    case "source_verified":
      return { complete: true, status: "Source verified", next: "View launch details" };
    case "indexed":
      return { complete: true, status: "Indexed", next: "View launch details" };
    default:
      return null;
  }
}
