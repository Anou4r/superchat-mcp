import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer, loadConfig } from "../src/server.js";
import type { SuperchatRequest } from "../src/client.js";

interface Operation {
  method: string;
  path: string;
  source: string;
  parameters: { name: string; in: string; required?: boolean; schema: object }[];
  body?: object;
  bodyRequired?: boolean;
}
const contract = JSON.parse(
  readFileSync(new URL("./fixtures/public-api-contract.json", import.meta.url), "utf8"),
) as {
  operations: Operation[];
  components: { schemas: Record<string, object> };
};
const ajv = new Ajv2020({ strict: false, allErrors: true });
const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
addFormats(ajv);

const samples: Record<string, Record<string, unknown>> = {
  get_me: {},
  list_channels: {},
  get_channel: { channel_id: "mc_1" },
  list_inboxes: {},
  get_inbox: { inbox_id: "ib_1" },
  list_users: {},
  get_user: { user_id: "usr_1" },
  list_labels: {},
  get_label: { label_id: "la_1" },
  list_files: {},
  get_file: { file_id: "fi_1" },
  list_contact_lists: {},
  get_contact_list: { contact_list_id: "cl_1" },
  list_custom_attributes: {},
  list_templates: { channel_id: "mc_1", folder_id: "tf_1", type: "whats_app_template", limit: 100 },
  get_template: { template_id: "tpl_1" },
  list_contacts: { after: "ct_before", limit: 10 },
  get_contact: { contact_id: "ct_1" },
  search_contacts: { field: "phone", value: "+491701234567" },
  list_contact_conversations: { contact_id: "ct_1" },
  list_contact_lists_for_contact: { contact_id: "ct_1" },
  add_contact_to_contact_list: { contact_id: "ct_1", contact_list_id: "cl_1" },
  remove_contact_from_contact_list: { contact_id: "ct_1", contact_list_id: "cl_1" },
  create_contact: { first_name: "Jane", handles: [{ type: "mail", value: "jane@example.com" }] },
  update_contact: {
    contact_id: "ct_1",
    first_name: "Jane",
    last_name: null,
    gender: "unknown",
    handles: [{ id: "ch_1", type: "mail", value: "jane@example.com" }],
    custom_attributes: [{ id: "cat_1", value: ["VIP"] }],
  },
  delete_contact: { contact_id: "ct_1" },
  list_conversations: {},
  get_conversation: { conversation_id: "cv_1" },
  list_conversation_messages: {
    conversation_id: "cv_1",
    after: "msg_1",
    created_after: "2026-01-01T00:00:00Z",
    created_before: "2026-01-02T00:00:00Z",
  },
  list_conversation_notes: { conversation_id: "cv_1" },
  get_conversation_note: { conversation_id: "cv_1", note_id: "no_1" },
  create_conversation_note: {
    conversation_id: "cv_1",
    content: "Please call back",
    file_ids: ["fi_1"],
  },
  update_conversation_note: {
    conversation_id: "cv_1",
    note_id: "no_1",
    content: "Called back",
    file_ids: [],
  },
  delete_conversation_note: { conversation_id: "cv_1", note_id: "no_1" },
  delete_conversation: { conversation_id: "cv_1" },
  update_conversation: {
    conversation_id: "cv_1",
    status: "snoozed",
    snoozed_until: "2026-12-01T10:00:00Z",
    inbox_id: "ib_1",
    labels: ["la_1"],
    assigned_users: ["usr_1"],
  },
  create_conversation_export: { conversation_id: "cv_1" },
  get_conversation_export: { conversation_id: "cv_1", export_id: "cex_1" },
  send_text: { channel_id: "mc_1", to: "+491701234567", text: "Hello" },
  send_template: {
    channel_id: "mc_1",
    to: "+491701234567",
    type: "whats_app_template",
    template_id: "tpl_1",
    variables: [{ position: 1, value: "Jane" }],
    file_id: "fi_1",
  },
  send_media: { channel_id: "mc_1", to: "+491701234567", file_id: "fi_1" },
  send_email: {
    channel_id: "mc_1",
    to: "jane@example.com",
    subject: "Hello",
    text: "How can we help?",
    file_ids: ["fi_1"],
  },
};

function assertContract(request: SuperchatRequest): void {
  const operation = contract.operations.find(
    (candidate) =>
      candidate.method === request.method &&
      new RegExp(`^${candidate.path.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(request.path),
  );
  assert.ok(operation, `No public contract for ${request.method} ${request.path}`);
  const queryParameters = operation.parameters.filter((parameter) => parameter.in === "query");
  const querySchema = {
    type: "object",
    properties: Object.fromEntries(
      queryParameters.map((parameter) => [parameter.name, parameter.schema]),
    ),
    required: queryParameters
      .filter((parameter) => parameter.required)
      .map((parameter) => parameter.name),
    additionalProperties: false,
    components: contract.components,
  };
  const validateQuery = ajv.compile(querySchema);
  assert.ok(
    validateQuery(request.query ?? {}),
    `${operation.source}: ${ajv.errorsText(validateQuery.errors)}`,
  );
  if (request.body !== undefined) {
    assert.ok(operation.body, `Unexpected body for ${operation.source}`);
    const validateBody = ajv.compile({ ...operation.body, components: contract.components });
    assert.ok(
      validateBody(request.body),
      `${operation.source}: ${ajv.errorsText(validateBody.errors)}`,
    );
  } else assert.ok(!operation.bodyRequired, `Missing body for ${operation.source}`);
}

test("every registered tool produces a request accepted by the saved public API contract", async (t) => {
  const requests: SuperchatRequest[] = [];
  const server = createServer(
    { ...loadConfig({}), enableWrites: true, enableDeletes: true, enableEnterpriseTools: true },
    {
      client: {
        async request(request) {
          requests.push(request);
          return { ok: true };
        },
      },
    },
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "contract-test", version: "1" });
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await client.connect(ct);
  const { tools } = await client.listTools();
  assert.equal(tools.length, Object.keys(samples).length);
  for (const tool of tools) {
    const args = samples[tool.name.replace(/^superchat_/, "")];
    assert.ok(args, `Missing sample for ${tool.name}`);
    const result = await client.callTool({ name: tool.name, arguments: args });
    assert.ok(!result.isError, `${tool.name}: ${JSON.stringify(result)}`);
    const request = requests.at(-1);
    assert.ok(request);
    assertContract(request);
  }
  assert.equal(requests.length, tools.length);
});
