# Private project connections

Connections belong to one authenticated owner and one project. A reviewed
manifest records the exact HTTPS origin, actions, schemas and permissions.
API keys and OAuth tokens are encrypted with AES-256-GCM and authenticated
owner/project/connection context. Keyring versions support rotation. Runtime
code and model prompts receive results, not decrypted credentials.

Supported profiles:

- Public JSON and header-based API keys; reviewed GET/POST/PUT/PATCH/DELETE
  actions, scalar query parameters and JSON bodies.
- OAuth authorization code with PKCE S256, an owner-bound ten-minute one-use
  state, refresh tokens and revocation. The browser callback returns to the
  signed-in project interface before authenticated completion.
- OpenAPI 3 import with local schema references and explicit path/query/body
  bindings. Unsupported cookie/header parameters and body formats are reported.
- Remote MCP tools using explicit `2026-07-28` or `2025-11-25` protocol
  profiles. Modern requests include protocol metadata and mirrored headers;
  legacy requests use initialization and scoped sessions. Tool changes require
  renewed review. Discovery grants no execution rights. MCP tools are classified
  as writes conservatively, independent of server annotations.
- Signed JSON webhooks with timestamp validation and persistent event-ID
  deduplication. Receiving an event alone does not authorize a contract action.

Webhook senders sign the UTF-8 JSON encoding of
`["programmable-webhook-v1", routeId, eventId, timestamp, exactBodyText]`
with HMAC-SHA256 and the private webhook key. Send its lowercase hexadecimal
digest as `X-Programmable-Signature`, the event ID as
`X-Programmable-Event-Id`, and Unix seconds as `X-Programmable-Timestamp`.
The timestamp is a decimal string. Both the route and event ID are signed;
reusing a delivery with a different identity is rejected. Retries preserve
all five values. The earlier timestamp/body-only format is not accepted.

HTTPS transport resolves and checks every address, pins the checked IP while
retaining the original TLS identity, refuses redirects/private networks and
bounds requests, responses and time. Logs/results redact known credential
values and secret-bearing fields. A completed write has a stable receipt;
an uncertain write is not dispatched again automatically.

The protocol implementation follows the
[MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
and its documented legacy compatibility rules. Optional sampling, elicitation,
resources, subscriptions and server-initiated work are not granted by this tool
connection profile.

An owned HTTPS fixture verified authenticated reads, a real PKCE token exchange,
refresh, MCP discovery/call, secret redaction and revocation. A second connection
used a separate public API domain through the same implementation. This checks
the connection service; product-wide availability still requires the final
platform rollout and browser acceptance checks.
