# Launch CLI 4.4.1

Windows packing now finishes writing both the launch request and its receipt. Windows skips the unsupported parent-directory sync; temporary-file sync, atomic rename, exclusive journal creation and error propagation remain in place.

This is a client-only patch. Existing API profiles, deployed contracts, fees and launch request semantics are unchanged. Its source binding reuses the verified Elysium 4.4.0 acceptance and historical Robinhood API 4.1.0 evidence.

Install the immutable release from [programmable-launch-v4.4.1](https://github.com/programmablehq/PROGRAMMABLE/releases/tag/programmable-launch-v4.4.1), checking its SHA-256 and attestation as described in [the CLI release procedure](../../programmable-launch-cli-release.md). A source merge alone does not establish package availability.

The candidate tarball produced with Node 24.14.0 and npm 11.16.0 has SHA-256 `72d4fbfb2989dcd33f32224a8ee9649548c83cf6f0b1b2502b545747c0896faa`. Publication must reproduce these bytes.
