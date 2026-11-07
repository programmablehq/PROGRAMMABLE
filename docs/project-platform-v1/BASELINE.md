# Project Platform V1 baseline

The initial website reference is `805a831a023d0b3e46494b66c6118d8532c5f950`. The backend reference is `82cfdad10adcd884e234e0bb8e33e6808e7f6b4b`. These identify the inspected baseline, not the final platform release.

Existing capabilities include saved conversations, exact Solidity projects, contract compilation and behavior checks, owned public-JSON readers and chain-specific launch preparation. Authenticated arbitrary API connectors, a general project filesystem, persistent application hosting and a general code-execution workspace are not completed capabilities in this baseline.

Two bounded real-model planning probes used the existing configured provider with execution hooks disabled:

- A German colloquial fee request retained six requirements, including the selected chain, both fee phases and platform constraints. No compiler or source persistence was invoked.
- A game/web/backend/authenticated-API request retained six requirements and explicitly identified missing application services and the event connection. The result did not claim those services were deployed.

Those observations establish a starting point, not completion of the reference projects. The six end-to-end cases remain open until their respective implementations and runtime observations pass.

The first live development-runtime probe used one Vercel Sandbox vCPU, a 30-second timeout, the node24 runtime, a deny-all network policy and automatic removal. A file write/read completed and an external request failed under the policy. The command exited successfully; subsequent sandbox inventory was empty. This is a bounded smoke test, not a general sandbox security audit.

The reference comparison helper rejects missing requirements, tests from other revisions, missing runtime stages, contradictory results and forbidden actions. It produces assessment reports only and cannot authorize a launch.
