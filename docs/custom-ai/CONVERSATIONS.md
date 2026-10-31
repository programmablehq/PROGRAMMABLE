# Private conversations

Each selected wallet has a private chat list under the authenticated website account. A new chat uses a UUID. Its studio key is SHA-256 of the lowercased wallet, a colon and the chat ID. The original `legacy-wallet-studio` keeps the existing wallet-only hash and browser cache key; it is never overwritten by creating another chat. A recoverable previous coin remains available under Options in that legacy chat.

The metadata and studio reuse `programmable_custom_ai_v1.objects`. No model call, additional key, schema grant or new financial store is needed. Lists return at most 20 records and use the exact database timestamp plus object ID for their cursor. Search applies to chat titles inside the authenticated owner and selected wallet. The API revalidates wallet membership on every read and write. Archiving is recoverable. Renames and archive actions use the current metadata revision.

A request carries its chat, selected wallet and expected studio revision. The reservation transaction checks that basis, verifies context/draft ownership within that same chat, then binds the recovery pointer before charging and inserting the job. A stale or archived chat fails without charging. Old unbound drafts can only enter the original wallet studio. No client request receives authority to alter an external review or launch permission.

The composer flushes the current studio before dispatch and caches the exact resulting request before POST. Changing chats disposes the old reply receiver while the existing durable server job continues. The saved studio exposes the owned pending request for read-only recovery on another device. A completed reply clears that recovery pointer when its context is saved. Failed work leaves the submitted text available. The original snapshot format gains empty input and edit-target fields without relaxing revision comparison.

Unsent text, current image receipt, selected rule, messages, source/draft references and open changes use separate per-chat keys. Image Blobs remain in IndexedDB. Rename and archive metadata never grants financial execution. Account concurrency and provider caps are unchanged.

## Endpoints

- GET `/api/custom-ai/conversations?account=...`: active list, with optional `q`, `cursor` and `archived=true`.
- GET the same endpoint with `id`: one scoped metadata record.
- POST `action: bootstrap`: idempotently register the original wallet studio.
- POST `action: create` with a UUID: create another chat.
- POST `action: update` with metadata `revision`: rename or archive/restore.
- Existing studio and version endpoints accept the chat identifier and retain their CAS and job/source checks.

These endpoints require the existing website session. A Custom Launch API key does not provide access to private chats.
