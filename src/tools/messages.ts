import { z } from "zod/v4";
import { id, nonempty, type RegisterTool } from "./shared.js";

const addressFields = {
  channel_id: id.describe(
    "ID of the connected channel to send from; discover channels with list_channels.",
  ),
  to: nonempty.describe(
    "Exactly one recipient identifier accepted by this channel, usually an E.164 phone number or email address. Match it to the selected channel and contact.",
  ),
  sender_name: nonempty.optional().describe("Optional sender display name."),
  in_reply_to: id
    .optional()
    .describe(
      "Optional message ID to reply to; this is a message ID, not a conversation or contact ID.",
    ),
};

function envelope(
  args: {
    channel_id: string;
    to: string;
    sender_name?: string | undefined;
    in_reply_to?: string | undefined;
  },
  content: unknown,
) {
  return {
    to: [{ identifier: args.to }],
    from: { channel_id: args.channel_id, name: args.sender_name ?? null },
    content,
    ...(args.in_reply_to ? { in_reply_to: args.in_reply_to } : {}),
  };
}

export function registerMessageTools(register: RegisterTool): void {
  register(
    "send_text",
    "Send a customer-visible plain-text message to exactly one recipient. Use after resolving the correct contact and channel; for WhatsApp outside its 24-hour messaging window, use send_template. Instagram and Messenger replies must stay within their channel reply windows. A successful API response means accepted, not delivered. If the result is uncertain, check before retrying.",
    z.strictObject({
      ...addressFields,
      text: nonempty.describe("Plain-text message body to send to the customer."),
    }),
    (args) => ({
      method: "POST",
      path: "/messages",
      body: envelope(args, { type: "text", body: args.text }),
    }),
    "write",
    false,
  );
  register(
    "send_template",
    "Send one customer-visible template message. Inspect the template with get_template first; WhatsApp templates must be approved for the selected channel. Match variable positions to the template definition. The API response is not proof of delivery; check before retrying an uncertain send.",
    z
      .strictObject({
        ...addressFields,
        template_id: id.describe("Template ID returned by list_templates or get_template."),
        type: z
          .enum(["whats_app_template", "generic_template"])
          .describe("Template content type; use the type returned by the template record."),
        variables: z
          .array(
            z.strictObject({
              position: z
                .number()
                .int()
                .min(1)
                .describe("1-based placeholder position from get_template."),
              value: z.string().describe("Value to insert at this placeholder position."),
            }),
          )
          .optional()
          .describe(
            "Template placeholder values keyed by 1-based position. Use the positions and expected values shown by get_template.",
          ),
        file_id: id
          .optional()
          .describe(
            "Optional ID of a file already uploaded to Superchat for a WhatsApp template media header.",
          ),
      })
      .refine((args) => args.type === "whats_app_template" || args.file_id === undefined, {
        message: "file_id is only supported for WhatsApp templates.",
      })
      .refine(
        (args) =>
          new Set(args.variables?.map((v) => v.position)).size === (args.variables?.length ?? 0),
        { message: "Template variable positions must be unique." },
      ),
    (args) => ({
      method: "POST",
      path: "/messages",
      body: envelope(args, {
        type: args.type,
        template_id: args.template_id,
        ...(args.variables ? { variables: args.variables } : {}),
        ...(args.file_id ? { file: { id: args.file_id } } : {}),
      }),
    }),
    "write",
    false,
  );
  register(
    "send_media",
    "Send one already uploaded file to one customer. Discover uploaded file IDs with list_files; this tool does not upload local files. Respect the selected channel's messaging window and check before retrying an uncertain send.",
    z.strictObject({
      ...addressFields,
      file_id: id.describe(
        "ID of a file already uploaded to Superchat; discover available files with list_files.",
      ),
    }),
    (args) => ({
      method: "POST",
      path: "/messages",
      body: envelope(args, { type: "media", file_id: args.file_id }),
    }),
    "write",
    false,
  );
  register(
    "send_email",
    "Send one customer-visible email through a connected email channel. Use an email recipient and provide plain text, HTML, or both. Attachments must already be uploaded. An API response is not proof of delivery; check before retrying an uncertain send.",
    z
      .strictObject({
        ...addressFields,
        subject: nonempty.describe("Email subject line."),
        text: nonempty.optional().describe("Optional plain-text email body."),
        html: nonempty.optional().describe("Optional HTML email body."),
        file_ids: z
          .array(id)
          .optional()
          .describe("Optional IDs of files already uploaded to Superchat, to attach to the email."),
      })
      .refine((args) => args.text !== undefined || args.html !== undefined, {
        message: "Provide text or html.",
      }),
    (args) => ({
      method: "POST",
      path: "/messages",
      body: envelope(args, {
        type: "email",
        subject: args.subject,
        ...(args.text !== undefined ? { text: args.text } : {}),
        ...(args.html !== undefined ? { html: args.html } : {}),
        ...(args.file_ids ? { files: args.file_ids.map((fileId) => ({ id: fileId })) } : {}),
      }),
    }),
    "write",
    false,
  );
}
