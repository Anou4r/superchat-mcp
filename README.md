# Superchat MCP

An **unofficial** MCP server that connects Claude Desktop and other local MCP clients to the [public Superchat API](https://developers.superchat.com/reference/welcome).

Search contacts, inspect their cross-channel conversations, manage contact-list membership, review message history when Enterprise access is available, and send messages using your own Superchat API key. Each user runs their own process. No hosted service, account with this project, or database is required.

This project is not affiliated with, endorsed by, or supported by Superchat.

## Quick start with Claude Desktop

Requires **Node.js 22+**, npm, and a Superchat workspace with API access.

From a checkout of this repository:

```sh
npm ci
npm run build
```

Create and name an API key in Superchat under **Settings → Integrations → Explore**; scroll to the API key area. See [Superchat authentication](https://developers.superchat.com/reference/authentication).

Open Claude Desktop's **Settings → Developer → Edit Config** and merge this entry into `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "superchat": {
      "command": "node",
      "args": ["/absolute/path/to/superchat-mcp/dist/cli.js"],
      "env": {
        "SUPERCHAT_API_KEY": "YOUR_SUPERCHAT_API_KEY"
      }
    }
  }
}
```

Replace the absolute path and API key, then fully quit and reopen Claude Desktop. If Claude cannot find `node`, set `command` to its absolute executable path. On Windows, use a path such as `C:\\projects\\superchat-mcp\\dist\\cli.js` in JSON. An editable example is in [examples/claude-desktop.json](examples/claude-desktop.json).

This is a **local stdio integration**. Add it through the desktop application's developer configuration, not a remote connector URL. The [official MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers) explains the connection model.

Try:

> Find the contact with email jane@example.com and show their conversations and internal notes.

> List our WhatsApp channels and the templates available for a channel. Do not send anything yet.

### Enable writes

Reading is enabled by default. To create/update contacts, change conversations, add notes, create exports, or send messages, add this to the server's `env` configuration and restart the client:

```json
"SUPERCHAT_ENABLE_WRITES": "true"
```

Deletion requires both write access and:

```json
"SUPERCHAT_ENABLE_DELETES": "true"
```

Disabled tools are not registered and cannot be called directly. Tool annotations also tell the client which actions write or delete data; the client remains responsible for its user-approval experience. Enabling writes is not blanket permission for the assistant to send messages.

## Available tools

There are **26 read tools by default**, **11 optional write tools**, and **4 optional delete tools**. An additional Enterprise-only read tool can be enabled separately. Every tool name starts with `superchat_`.

| Group            | Read tools                                                                                                        | Write tools                                                       | Delete tools                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| Workspace        | `get_me`                                                                                                          | —                                                                 | —                                                    |
| Catalogs         | `list_channels`, `get_channel`, `list_inboxes`, `get_inbox`, `list_users`, `get_user`, `list_labels`, `get_label` | —                                                                 | —                                                    |
| Contacts         | `list_contacts`, `get_contact`, `search_contacts`, `list_contact_conversations`, `list_contact_lists_for_contact` | `create_contact`, `update_contact`, `add_contact_to_contact_list` | `delete_contact`, `remove_contact_from_contact_list` |
| Contact metadata | `list_contact_lists`, `get_contact_list`, `list_custom_attributes`                                                | —                                                                 | —                                                    |
| Conversations    | `list_conversations`, `get_conversation`, `list_conversation_messages` (Enterprise opt-in)                        | `update_conversation`                                             | `delete_conversation`                                |
| Internal notes   | `list_conversation_notes`, `get_conversation_note`                                                                | `create_conversation_note`, `update_conversation_note`            | `delete_conversation_note`                           |
| Exports          | `get_conversation_export`                                                                                         | `create_conversation_export`                                      | —                                                    |
| Templates        | `list_templates`, `get_template`                                                                                  | —                                                                 | —                                                    |
| Files            | `list_files`, `get_file`                                                                                          | —                                                                 | —                                                    |
| Messaging        | —                                                                                                                 | `send_text`, `send_template`, `send_media`, `send_email`          | —                                                    |

The resource **`superchat://guide`** explains discovery, safe update semantics, messaging windows, pagination and exports to the assistant.

Superchat assigns each person a contact ID and can associate that contact with conversations on several channels. A conversation is one thread on one channel. Contact lists group contacts for segmentation and campaigns; labels organize conversations. `list_contact_lists` and `get_contact_list` return list metadata (ID, name and URL), not its participants. Use `list_contact_lists_for_contact` to see a specific contact's memberships, `add_contact_to_contact_list` to add membership, and `remove_contact_from_contact_list` to remove membership without deleting either the contact or the list.

Enable the Enterprise-only message-history tool for an Enterprise workspace by setting `SUPERCHAT_ENABLE_ENTERPRISE_TOOLS=true` and restarting Claude. This only registers the tool; Superchat checks the actual workspace/API-key entitlement when it is called. Contact your account manager for access if Superchat returns `403`.

## API behavior and limits

- **Pagination:** list calls return one page (25 records by default, up to 100). The Enterprise message-history endpoint defaults to 20. Pass the returned `pagination.next_cursor` as `after`, or `previous_cursor` as `before`. The server never silently downloads every page or follows API-provided URLs.
- **Contact search:** exactly one equality expression for `mail`, `phone`, `instagram`, or `custom_attribute`. Custom attributes require an `identifier`. There is no fuzzy name search in this wrapper.
- **Contact handles:** a person may have handles on several channels, but the public create/update contact schema lets API clients set email and phone handles. Platform-owned IDs such as Instagram or Messenger IDs are assigned by those platforms. Superchat generates the contact ID.
- **Contact lists:** list/get endpoints expose list metadata only, not list members. Membership is inspected per contact and can be added or removed separately; removing membership does not delete the contact or list.
- **Conversation lookup:** `list_contact_conversations` returns the contact's conversation threads and their metadata across channels. `get_conversation` reads one thread's metadata; neither returns messages.
- **Contact updates:** the documented schema requires `first_name`, `last_name`, and `gender`. Read the contact and preserve values you want to keep; explicit `null` clears these fields. Supplied `handles` and `custom_attributes` replace the entire lists. Omit them to leave them unchanged.
- **Conversation updates:** `assigned_users` and `labels` specify complete lists. An empty array clears the list. Conversation status and the channel's messaging `time_window` are separate concepts.
- **Sending:** uses one recipient identifier plus `channel_id`, not `conversation_id`. `in_reply_to` is a message ID. Check WhatsApp template approval, channel and variables before sending. Successful submission is not proof of delivery.
- **Message history:** `list_conversation_messages` uses a documented, Enterprise-only endpoint. Superchat must enable access for the workspace/API key; contact the account manager if it returns `403`. The paginated result contains inbound/outbound messages and supports optional `created_after` and `created_before` ISO 8601 filters. It is separate from internal notes. Conversation exports also return an asynchronous job's download link; they do not download or parse it.
- **Media:** sending uses already uploaded file IDs. Local file upload and downloads are outside this version's scope.
- **Other endpoints:** webhook administration, template creation, custom attribute administration, analytics and interactive WhatsApp message types are not implemented in this version. This is a curated integration, not full API coverage.

The API uses `X-API-KEY` against `https://api.superchat.com/v1.0`. The documented [rate limit](https://developers.superchat.com/reference/rate-limiting) is 2,500 requests per workspace per five minutes, shared across its API keys.

GET requests retry network failures and HTTP 429/502/503/504 up to the configured limit, within a total request deadline. `Retry-After` is respected; waits over 30 seconds are returned to the client instead of retrying early. **Writes are never automatically retried**, including POST contact search. After a timed-out send, verify its outcome before repeating it. Responses larger than 5 MiB are rejected.

## Configuration

| Variable                            | Default | Meaning                                                             |
| ----------------------------------- | ------- | ------------------------------------------------------------------- |
| `SUPERCHAT_API_KEY`                 | unset   | Your API key; required for API calls                                |
| `SUPERCHAT_ENABLE_WRITES`           | `false` | Register the write tools                                            |
| `SUPERCHAT_ENABLE_DELETES`          | `false` | Register delete tools; requires writes                              |
| `SUPERCHAT_ENABLE_ENTERPRISE_TOOLS` | `false` | Register the Enterprise message-history tool                        |
| `SUPERCHAT_TIMEOUT_MS`              | `30000` | Total request deadline, including retries/body reading; 1–300000 ms |
| `SUPERCHAT_MAX_RETRIES`             | `2`     | Maximum GET retries after the first attempt; 0–5                    |

Boolean settings accept only `true` or `false`. Invalid configuration fails startup. Restart the MCP process after changing settings.

Without an API key the server can start, advertise its tools and return the guide. API calls then return a `MISSING_API_KEY` tool error. This permits credential-free discovery and registry inspection.

For terminal development, copy [.env.example](.env.example) to `.env`, fill it locally, and explicitly load it:

```sh
node --env-file=.env dist/cli.js
```

The program waits for MCP input; it is not an interactive terminal application. It does not implicitly load `.env` from an arbitrary working directory. Claude's `env` block is sufficient without an `.env` file.

## Data handling

The server does not persist API responses, log message content, or send telemetry. It passes selected results to the connected MCP client, which may send them to its model provider. Configure that client according to your organization's requirements.

Keep API keys out of source control. Superchat keys currently grant global read/write access; this server's local tool gates do not change the key's upstream permissions. API errors redact the configured key. Redirects and arbitrary request URLs are rejected. Returned contact, note and template text is treated as untrusted content, not instructions.

## Development

```sh
npm ci
npm run check
npm run dev
```

`check` runs formatting, strict TypeScript checks, offline tests and a production build. Tests cover the HTTP client, access gates, request schemas, cursor validation, errors, and compiled stdio startup using both legacy and current MCP clients. They never access a real Superchat workspace or send customer messages.

The [saved public API contract](test/fixtures/public-api-contract.json) records source URLs and the retrieval date. Every tool's representative request is validated against it. See [docs/api-contract.md](docs/api-contract.md) for provenance and maintenance.

```text
src/
  cli.ts                 stdio entry point
  server.ts              transport-independent server factory
  config.ts              environment validation
  client.ts              authenticated HTTP client, deadlines, retries, errors
  guide.ts               assistant-readable workflow guide
  tools/                 catalogs, contacts, conversations, messages
test/                    unit, protocol, CLI and public-contract tests
examples/                Claude Desktop configuration
```

## Packaging and publication

This checkout is ready to build and package locally; it has **not been published to npm** as part of its creation. Do not assume an existing registry package with the same name belongs to this project.

```sh
npm run check
npm pack --dry-run
npm pack
```

The tarball contains the compiled server and documentation. Maintainers should set the final npm name, repository URL and ownership before publishing. Once released under that verified name, clients can use `npx` instead of a checkout path. No publishing credentials or automatic release workflow are included.

## License

[MIT](LICENSE). Superchat is a trademark of its respective owner.
