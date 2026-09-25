import { z } from "zod/v4";
import { id, nonempty, page, type RegisterTool } from "./shared.js";

export function registerConversationTools(register: RegisterTool): void {
  register(
    "list_conversations",
    "List one page of conversation threads across the workspace. Results contain conversation metadata, not messages, and the public endpoint has no status, inbox or text filter. Use list_contact_conversations to scope the list to one contact.",
    page({}),
    (query) => ({ method: "GET", path: "/conversations", query }),
  );
  register(
    "get_conversation",
    "Read one conversation thread's contact, channel, inbox, status and channel-specific messaging time window. Use list_conversation_messages for its message history when Enterprise access is enabled. Conversation status (such as open) does not determine whether a channel's messaging window is open.",
    z.strictObject({
      conversation_id: id.describe(
        "Superchat conversation ID, for example one returned by list_conversations or list_contact_conversations.",
      ),
    }),
    ({ conversation_id }) => ({ method: "GET", path: `/conversations/${conversation_id}` }),
  );
  register(
    "list_conversation_messages",
    "Read one page of customer-visible inbound and outbound messages in a conversation. This endpoint is available only to Enterprise customers and requires Superchat to enable access for the workspace/API key; contact your account manager if it returns 403. Use list_conversation_notes for internal notes. Each call returns one page; use after or before to continue and created_after/created_before to bound message creation time.",
    page({
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Page size, at most 100. Defaults to 20."),
      conversation_id: id.describe("Conversation ID whose message history to retrieve."),
      created_after: z.iso
        .datetime({ offset: true })
        .optional()
        .describe("Lower bound for message creation time as an ISO 8601 timestamp with timezone."),
      created_before: z.iso
        .datetime({ offset: true })
        .optional()
        .describe("Upper bound for message creation time as an ISO 8601 timestamp with timezone."),
    }).refine(
      (args) =>
        !args.created_after ||
        !args.created_before ||
        Date.parse(args.created_after) <= Date.parse(args.created_before),
      { message: "created_after must not be after created_before." },
    ),
    ({ conversation_id, ...query }) => ({
      method: "GET",
      path: `/conversations/${conversation_id}/messages`,
      query,
    }),
    "enterprise",
    false,
  );
  register(
    "list_conversation_notes",
    "List one page of internal notes attached to a conversation. These notes are visible to the team, not customer messages; use list_conversation_messages for message history when Enterprise access is enabled.",
    page({ conversation_id: id.describe("Conversation ID whose internal notes to list.") }),
    ({ conversation_id, ...query }) => ({
      method: "GET",
      path: `/conversations/${conversation_id}/notes`,
      query,
    }),
  );
  register(
    "get_conversation_note",
    "Read one internal note from a conversation by note ID. This does not retrieve a customer message.",
    z.strictObject({
      conversation_id: id.describe("Conversation ID containing the note."),
      note_id: id.describe(
        "Internal note ID, for example one returned by list_conversation_notes.",
      ),
    }),
    ({ conversation_id, note_id }) => ({
      method: "GET",
      path: `/conversations/${conversation_id}/notes/${note_id}`,
    }),
  );
  register(
    "get_conversation_export",
    "Check the status of an asynchronous conversation export job and retrieve its download link. Use after create_conversation_export; this tool returns the URL but does not fetch or parse the file.",
    z.strictObject({
      conversation_id: id.describe("Conversation ID for the export."),
      export_id: id.describe("Export job ID returned by create_conversation_export."),
    }),
    ({ conversation_id, export_id }) => ({
      method: "GET",
      path: `/conversations/${conversation_id}/export/${export_id}`,
    }),
  );
  register(
    "create_conversation_export",
    "Start an asynchronous export for one conversation, optionally bounded by a time range. This creates an export job and does not send a message or download the archive. Use get_conversation_export with the returned job ID to check completion and retrieve its download link.",
    z
      .strictObject({
        conversation_id: id.describe("Conversation ID to export."),
        start: z.iso
          .datetime({ offset: true })
          .nullable()
          .default(null)
          .describe("Optional start of the export range as an ISO 8601 timestamp with timezone."),
        end: z.iso
          .datetime({ offset: true })
          .nullable()
          .default(null)
          .describe("Optional end of the export range as an ISO 8601 timestamp with timezone."),
      })
      .refine(
        (args) => !args.start || !args.end || Date.parse(args.start) <= Date.parse(args.end),
        { message: "start must not be after end." },
      ),
    ({ conversation_id, ...body }) => ({
      method: "POST",
      path: `/conversations/${conversation_id}/export`,
      body,
    }),
    "write",
    false,
  );
  register(
    "update_conversation",
    "Change a conversation's status, inbox, assigned users or labels. Use list_users, list_inboxes and list_labels to resolve IDs first. Supplied assigned_users and labels replace the full lists; [] clears them. Set snoozed_until when setting status to snoozed. Conversation status does not open a channel messaging window.",
    z
      .strictObject({
        conversation_id: id.describe("Conversation ID to update."),
        status: z
          .enum(["open", "done", "spam", "archived", "snoozed"])
          .optional()
          .describe(
            "New conversation state. A new inbound message can reopen a conversation marked done.",
          ),
        inbox_id: id.optional().describe("Destination inbox ID; discover IDs with list_inboxes."),
        snoozed_until: z.iso
          .datetime({ offset: true })
          .nullable()
          .optional()
          .describe("Required when status is snoozed; ISO 8601 timestamp with timezone."),
        assigned_users: z
          .array(id)
          .optional()
          .describe(
            "Complete list of assigned user IDs; omit to keep current assignees or [] to clear them.",
          ),
        labels: z
          .array(id)
          .optional()
          .describe(
            "Complete list of conversation label IDs; omit to keep current labels or [] to clear them.",
          ),
      })
      .refine((args) => Object.keys(args).length > 1, {
        message: "Supply at least one field to update.",
      })
      .refine((args) => args.status !== "snoozed" || typeof args.snoozed_until === "string", {
        message: "Snoozing requires snoozed_until.",
      }),
    ({ conversation_id, ...body }) => ({
      method: "PATCH",
      path: `/conversations/${conversation_id}`,
      body,
    }),
    "write",
  );
  register(
    "create_conversation_note",
    "Add an internal team note to a conversation. This is not sent to the customer. Attachments must use file IDs already uploaded to Superchat.",
    z.strictObject({
      conversation_id: id.describe("Conversation ID where the note will be added."),
      content: nonempty.describe("Text of the internal note."),
      file_ids: z.array(id).optional().describe("IDs of files already uploaded to Superchat."),
    }),
    ({ conversation_id, ...body }) => ({
      method: "POST",
      path: `/conversations/${conversation_id}/notes`,
      body,
    }),
    "write",
    false,
  );
  register(
    "update_conversation_note",
    "Replace the content of an internal conversation note and optionally its attachment list. This does not send a customer message. Omit file_ids to leave attachments unchanged; [] removes all attachments.",
    z.strictObject({
      conversation_id: id.describe("Conversation ID containing the note."),
      note_id: id.describe("Internal note ID to update."),
      content: nonempty.describe("Replacement text for the internal note."),
      file_ids: z
        .array(id)
        .optional()
        .describe(
          "Replacement list of already uploaded file IDs; omit to retain the current attachments or [] to remove them.",
        ),
    }),
    ({ conversation_id, note_id, ...body }) => ({
      method: "PUT",
      path: `/conversations/${conversation_id}/notes/${note_id}`,
      body,
    }),
    "write",
  );
  register(
    "delete_conversation_note",
    "Permanently delete one internal note from a conversation. This does not delete the conversation or its messages. Only use when the user explicitly requests note deletion.",
    z.strictObject({
      conversation_id: id.describe("Conversation ID containing the note."),
      note_id: id.describe("Internal note ID to delete."),
    }),
    ({ conversation_id, note_id }) => ({
      method: "DELETE",
      path: `/conversations/${conversation_id}/notes/${note_id}`,
    }),
    "delete",
  );
  register(
    "delete_conversation",
    "Permanently delete a conversation thread by ID. This is different from marking it done or removing a label. Only use when the user explicitly requests conversation deletion.",
    z.strictObject({ conversation_id: id.describe("Conversation ID to permanently delete.") }),
    ({ conversation_id }) => ({ method: "DELETE", path: `/conversations/${conversation_id}` }),
    "delete",
  );
}
