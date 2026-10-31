# Custom AI model providers

The provider is selected once in server configuration. Chat clients cannot choose a provider, inject an endpoint or change the model budget. Jobs record the selected provider and model roles alongside the AI configuration version.

## Surplus

Set `CUSTOM_AI_PROVIDER=surplus` and supply `SURPLUS_API_KEY` as a server-only secret. Use a dedicated Programmable buyer key and budget. Do not reuse another product's funded allowance. The adapter only calls the fixed `https://api.surplusintelligence.ai/v1` origin, with redirects disabled.

The configured roles are `claude-haiku-5.5` for planning, `claude-sonnet-5.5` for generation and `claude-opus-5.5` for the final bounded repair attempt. These are Surplus catalog ids; direct Anthropic uses different ids. Validate the model catalog and actual seller availability when activating or updating them. The application does not request the catalog on every chat turn.

Generation uses `/chat/completions` with strict JSON schema output. Streaming must complete with a normal stop and a terminal event. An HTTP 200 error envelope, a truncated result or a refused answer is not a usable draft. Responses and events are bounded. Provider failures retain the draft and follow the existing cooldown, request identity and allowance rules; the adapter does not blindly replay requests.

The Claude bridge rejects the planner's nested `anyOf` tool envelopes, nullable object schemas and several JSON Schema length/range keywords. Object union values travel as JSON-encoded strings; unsupported constraints remain in field descriptions and are enforced locally. The adapter restores the result and validates it against the complete original schema before the planner or any tool can use it. Runtime tool validation, available tools and lookup limits remain authoritative.

Surplus selection never falls back to the direct Anthropic key. An empty Surplus key stops before a provider request. Each provider has its own cooldown, so an Anthropic billing incident does not disable a valid Surplus connection.

## Web research

Catalog and hook search remain available independently of hosted web search. To enable hosted research through Surplus, configure `CUSTOM_AI_SURPLUS_WEB_SEARCH_MODEL` only after verifying a native Responses seller with the web-search tool. Research uses `/responses`, at most one provider call per lookup, and requires both the completed search tool call and URL citations. A catalog label alone does not prove that the selected seller supports hosted search.

When Surplus is selected, an unconfigured research model never sends the query to Anthropic. The planner sees only the research tools that are available under the current configuration.

## Activation

Keep existing financial contracts and user draft stores unchanged. Before switching the production environment, verify the dedicated key's scope and budget, a bounded schema/stream request, and a complete draft generation. Then publish through the ordinary interface release and check `/api/custom-ai/capabilities` for the active provider. Deployment alone does not prove inference or funded launches.

The direct Anthropic path is retained for an explicit operator rollback (`CUSTOM_AI_PROVIDER=anthropic`, or the legacy unset value). It is not an automatic fallback and does not authorize a purchase or higher spending limit.

References: [Surplus chat completions](https://www.surplusintelligence.ai/docs/api-reference/chat-completions), [model capabilities](https://www.surplusintelligence.ai/docs/api-reference/models), [Responses](https://www.surplusintelligence.ai/docs/api-reference/responses).
