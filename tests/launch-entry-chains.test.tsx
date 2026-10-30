import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LaunchModelPicker } from "@/components/launch-entry";

describe("launch choices match supported chain routes", () => {
  it.each([8453, 999] as const)("does not offer the unavailable Module route on chain %s", chainId => {
    const html = renderToStaticMarkup(<LaunchModelPicker chainId={chainId} />);
    expect(html).not.toContain(`/launch/modules/foundation?chainId=${chainId}`);
    expect(html).toContain(`chainId=${chainId}`);
    expect(html).toContain('aria-label="Launch a custom hook"');
  });
  it.each([1, 4663] as const)("keeps Module and Custom launch choices on chain %s", chainId => {
    const html = renderToStaticMarkup(<LaunchModelPicker chainId={chainId} />);
    expect(html).toContain(`/launch/modules/foundation?chainId=${chainId}`);
    expect(html).toContain('aria-label="Launch a custom hook"');
  });
});
