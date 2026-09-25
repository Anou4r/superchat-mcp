# Public API contract

The implementation targets Superchat's public API v1.0 at `https://api.superchat.com/v1.0`.

The request-only contract in `test/fixtures/public-api-contract.json` was extracted from **publicly accessible** OpenAPI 3.1 blocks in the endpoint Markdown documentation on 2026-09-25. Each operation carries its exact public source URL. Descriptions, examples, response schemas and discriminator annotations were omitted from this test fixture; validation constraints and referenced request schemas were retained.

Entry points:

- [Public reference](https://developers.superchat.com/reference/welcome)
- [Machine-readable index](https://developers.superchat.com/llms.txt)
- [Authentication](https://developers.superchat.com/reference/authentication)
- [Pagination](https://developers.superchat.com/reference/pagination)
- [Send message schema](https://developers.superchat.com/reference/post_messages)
- [Contact update schema](https://developers.superchat.com/reference/patch_contacts-contactid)
- [Add contact to contact list](https://developers.superchat.com/reference/post_contacts-contactid-contact-lists)
- [Remove contact from contact list](https://developers.superchat.com/reference/delete_contacts-contactid-contact-lists-contactlistid)

Public endpoint pages expose their Markdown version by appending `.md`. The structured request schemas take precedence over informal examples such as pagination text that says `next`/`previous`; the actual query parameters are `after`/`before`.

## Deliberate interface choices

- Curated task-oriented tools use strict, discoverable schemas. They do not expose a generic arbitrary-URL API executor.
- Four message tools share `POST /messages`, with an explicit single-recipient envelope and typed content.
- Tool list pagination defaults to 25, below the API's documented default of 50, with an upper bound of 100.
- API POST contact search is classified as a read tool. It still does not get automatic POST retries.
- Contact update scalar fields remain required, matching the published schema. Supplied list fields retain their documented replacement semantics.
- Notes are explicitly described as internal. Metadata tools do not pretend to return a transcript.
- Contact-list metadata and per-contact membership are separate operations; adding/removing membership does not create/delete the contact or list.
- The Enterprise-only message-history operation is sourced from its direct public reference page even though it is absent from the main API index. It is isolated as a read-only tool and uses no internal platform API.
- IDs are validated before interpolation into fixed API paths. API-provided export/file URLs are returned as data, never fetched with the API key.

`sc-platform` and Superchat's [Product Context](https://help.superchat.com/en/articles/835328-superchat-product-context) were consulted for product terminology and workflow context only. No private implementation or internal API contract was copied into this repository. The Propstack MCP project supplied the packaging/usage reference; this implementation is independent.

## Updating the fixture

Run `npm run contract:refresh` with internet access, review the fixture diff, and run `npm run check`. The refresh script fetches only the recorded public documentation URLs and includes only the operation and request schemas already selected for this server. It does not add tools automatically.

The contract test exercises every registered tool through the actual MCP SDK and validates generated query/body values using JSON Schema. This catches request-shape drift relative to the saved contract. It is not a live account test or a guarantee that every workspace plan permits every endpoint.
