import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer, loadConfig, type ServerConfig } from "../src/server.js";
import { SuperchatClient, type SuperchatRequest } from "../src/client.js";

async function connect(
  t: TestContext,
  overrides: Partial<ServerConfig> = {},
  response: unknown = { results: [], pagination: { next_cursor: "ct_next" } },
) {
  const requests: SuperchatRequest[] = [];
  const server = createServer(
    { ...loadConfig({}), ...overrides },
    {
      client: {
        async request(request) {
          requests.push(request);
          return response;
        },
      },
    },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1" });
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await client.connect(clientTransport);
  return { client, requests };
}

test("read-only discovery omits mutations and direct mutation calls cannot reach the API", async (t) => {
  const { client, requests } = await connect(t);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 26);
  assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true));
  assert.ok(tools.some((tool) => tool.name === "superchat_search_contacts"));
  for (const name of [
    "superchat_send_text",
    "superchat_delete_contact",
    "superchat_create_conversation_export",
    "superchat_list_conversation_messages",
  ]) {
    const result = await client.callTool({
      name,
      arguments: { channel_id: "mc_1", to: "+4912345", text: "test", contact_id: "ct_1" },
    });
    assert.equal(result.isError, true);
  }
  assert.equal(requests.length, 0);
});

test("write and delete permissions are separate and resource text contains no credentials", async (t) => {
  const { client } = await connect(t, { enableWrites: true, apiKey: "secret-not-for-resource" });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 37);
  assert.ok(
    tools.some(
      (tool) => tool.name === "superchat_send_template" && tool.annotations?.readOnlyHint === false,
    ),
  );
  assert.ok(!tools.some((tool) => tool.name.startsWith("superchat_delete")));
  const resources = await client.listResources();
  assert.equal(resources.resources[0]?.uri, "superchat://guide");
  const guide = await client.readResource({ uri: "superchat://guide" });
  assert.ok(JSON.stringify(guide).includes("time_window"));
  assert.ok(!JSON.stringify(guide).includes("secret-not-for-resource"));
  const enabled = await connect(t, { enableWrites: true, enableDeletes: true });
  await enabled.client.callTool({
    name: "superchat_delete_contact",
    arguments: { contact_id: "ct_1" },
  });
  assert.equal(enabled.requests[0]?.method, "DELETE");
  assert.equal(enabled.requests[0]?.path, "/contacts/ct_1");
});

test("pagination is bounded, cursors preserved and conflicting/unknown arguments rejected", async (t) => {
  const { client, requests } = await connect(t);
  const result = await client.callTool({ name: "superchat_list_contacts", arguments: {} });
  assert.equal(requests[0]?.query?.limit, 25);
  assert.deepEqual(result.structuredContent, {
    data: { results: [], pagination: { next_cursor: "ct_next" } },
  });
  await client.callTool({
    name: "superchat_list_contacts",
    arguments: { after: "ct_next", limit: 100 },
  });
  assert.equal(requests[1]?.query?.after, "ct_next");
  for (const args of [
    { limit: 101 },
    { limit: 0 },
    { after: "ct_1", before: "ct_2" },
    { status: "open" },
  ]) {
    const invalid = await client.callTool({ name: "superchat_list_contacts", arguments: args });
    assert.equal(invalid.isError, true);
  }
  assert.equal(requests.length, 2);
});

test("Enterprise conversation history applies its cursor and date filters", async (t) => {
  const { client, requests } = await connect(t, { enableEnterpriseTools: true });
  const listed = await client.callTool({
    name: "superchat_list_conversation_messages",
    arguments: { conversation_id: "cv_1" },
  });
  assert.ok(!listed.isError);
  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[0]?.path, "/conversations/cv_1/messages");
  assert.deepEqual(requests[0]?.query, { limit: 20 });
  const filtered = await client.callTool({
    name: "superchat_list_conversation_messages",
    arguments: {
      conversation_id: "cv_1",
      after: "msg_1",
      created_after: "2026-01-01T00:00:00Z",
      created_before: "2026-01-02T00:00:00Z",
      limit: 50,
    },
  });
  assert.ok(!filtered.isError);
  assert.deepEqual(requests[1]?.query, {
    after: "msg_1",
    created_after: "2026-01-01T00:00:00Z",
    created_before: "2026-01-02T00:00:00Z",
    limit: 50,
  });
  const invalid = await client.callTool({
    name: "superchat_list_conversation_messages",
    arguments: {
      conversation_id: "cv_1",
      created_after: "2026-02-01T00:00:00Z",
      created_before: "2026-01-01T00:00:00Z",
    },
  });
  assert.equal(invalid.isError, true);
  assert.equal(requests.length, 2);
});

test("contact search stays read-only and maps exactly one equality expression", async (t) => {
  const { client, requests } = await connect(t);
  await client.callTool({
    name: "superchat_search_contacts",
    arguments: { field: "mail", value: "jane@example.com" },
  });
  assert.deepEqual(requests[0]?.body, {
    query: { value: [{ field: "mail", operator: "=", value: "jane@example.com" }] },
  });
  assert.equal(requests[0]?.method, "POST");
  const invalid = await client.callTool({
    name: "superchat_search_contacts",
    arguments: { field: "custom_attribute", value: "VIP" },
  });
  assert.equal(invalid.isError, true);
  assert.equal(requests.length, 1);
});

test("contact updates preserve omitted lists and require explicit nullable scalar values", async (t) => {
  const { client, requests } = await connect(t, { enableWrites: true });
  const invalid = await client.callTool({
    name: "superchat_update_contact",
    arguments: { contact_id: "ct_1", first_name: "Jane" },
  });
  assert.equal(invalid.isError, true);
  await client.callTool({
    name: "superchat_update_contact",
    arguments: { contact_id: "ct_1", first_name: "Jane", last_name: null, gender: null },
  });
  assert.deepEqual(requests[0]?.body, { first_name: "Jane", last_name: null, gender: null });
});

test("sends use one recipient, channel, reply message ID and exact template wire format", async (t) => {
  const { client, requests } = await connect(t, { enableWrites: true });
  await client.callTool({
    name: "superchat_send_text",
    arguments: { channel_id: "mc_1", to: "+491701234567", text: "Hello", in_reply_to: "msg_1" },
  });
  assert.deepEqual(requests[0]?.body, {
    to: [{ identifier: "+491701234567" }],
    from: { channel_id: "mc_1", name: null },
    content: { type: "text", body: "Hello" },
    in_reply_to: "msg_1",
  });
  await client.callTool({
    name: "superchat_send_template",
    arguments: {
      channel_id: "mc_1",
      to: "+491701234567",
      type: "whats_app_template",
      template_id: "tpl_1",
      variables: [{ position: 1, value: "Jane" }],
      file_id: "fi_1",
    },
  });
  assert.deepEqual(requests[1]?.body, {
    to: [{ identifier: "+491701234567" }],
    from: { channel_id: "mc_1", name: null },
    content: {
      type: "whats_app_template",
      template_id: "tpl_1",
      variables: [{ position: 1, value: "Jane" }],
      file: { id: "fi_1" },
    },
  });
  const invalid = await client.callTool({
    name: "superchat_send_template",
    arguments: {
      channel_id: "mc_1",
      to: "+491701234567",
      type: "generic_template",
      template_id: "tpl_1",
      file_id: "fi_1",
    },
  });
  assert.equal(invalid.isError, true);
  assert.equal(requests.length, 2);
});

test("API errors survive the full MCP call path without exposing secrets", async (t) => {
  const apiKey = "super-secret";
  const server = createServer(
    { ...loadConfig({}), apiKey },
    {
      client: new SuperchatClient({
        apiKey,
        maxRetries: 0,
        fetch: async () =>
          Response.json({ errors: [{ detail: `Rejected ${apiKey}` }] }, { status: 403 }),
      }),
    },
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "1" });
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await client.connect(ct);
  const result = await client.callTool({ name: "superchat_get_me", arguments: {} });
  assert.equal(result.isError, true);
  assert.ok(JSON.stringify(result).includes("403"));
  assert.ok(!JSON.stringify(result).includes(apiKey));
});

test("current MCP protocol can discover tools and call them without a legacy handshake", async (t) => {
  const handler = createMcpHandler(() =>
    createServer(loadConfig({}), {
      client: {
        async request() {
          return { id: "usr_1" };
        },
      },
    }),
  );
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (input, init) => handler.fetch(new Request(input, init)),
  });
  const client = new Client(
    { name: "modern-test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  t.after(async () => {
    await client.close();
    await handler.close();
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 26);
  const result = await client.callTool({ name: "superchat_get_me", arguments: {} });
  assert.deepEqual(result.structuredContent, { data: { id: "usr_1" } });
});
