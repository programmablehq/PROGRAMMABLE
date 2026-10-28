# Adding a Custom AI capability

Add a server-only module under `lib/custom-ai/capabilities/`, export a `ToolCapability`, and register it once in `registry.server.ts`. Its description and input schema become the planner's available tools automatically. The module handles its own source and uses no wallet or signer interface.

Inputs are validated before dispatch. Tool versions are bound to stored requests. The dispatcher limits each turn to two lookups, propagates cancellation and bounds response size. A failed optional source is evidence of unavailability; it does not discard the saved design.

A tool returns `KnowledgeResult` with source links and original timestamps. Search output is untrusted data and cannot activate onchain behavior. Model/style changes go in `ai-config.ts`; change its version when semantics change. Keep product limits in the enforcing core.

Test the new adapter and its planner/dispatch integration. Search-only changes do not require deploying financial contracts. New money actions require their independent contract and lifecycle evidence before network activation.
