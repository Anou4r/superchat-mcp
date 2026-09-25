import { z } from "zod/v4";
import { id, page, type RegisterTool } from "./shared.js";

export function registerCatalogTools(register: RegisterTool): void {
  register(
    "get_me",
    "Identify the Superchat user associated with this API key. Use this to confirm which account the server is connected to.",
    z.strictObject({}),
    () => ({ method: "GET", path: "/me" }),
  );

  const catalogs = [
    {
      plural: "channels",
      singular: "channel",
      parameter: "channel_id",
      path: "channels",
      list: "connected channels in this workspace, such as WhatsApp, Instagram Direct, Facebook Messenger, SMS, email, Telegram, Live Chat or phone. Use a returned channel_id when sending.",
      get: "Read one connected channel's configuration by ID, for example before choosing a channel for a message.",
    },
    {
      plural: "inboxes",
      singular: "inbox",
      parameter: "inbox_id",
      path: "inboxes",
      list: "inboxes that organize conversations in this workspace. Use inbox IDs when routing a conversation.",
      get: "Read one inbox's details by ID.",
    },
    {
      plural: "users",
      singular: "user",
      parameter: "user_id",
      path: "users",
      list: "workspace users. Use their IDs when assigning conversations.",
      get: "Read one workspace user's details by ID.",
    },
    {
      plural: "labels",
      singular: "label",
      parameter: "label_id",
      path: "labels",
      list: "labels used to organize conversations. Labels belong to conversations, not contacts.",
      get: "Read one conversation label by ID. Labels apply to conversations, not contacts.",
    },
    {
      plural: "contact_lists",
      singular: "contact_list",
      parameter: "contact_list_id",
      path: "contact-lists",
      list: "contact lists used to group contacts for segmentation and campaigns. Results contain list metadata (ID, name and URL), not participants; use list_contact_lists_for_contact to find a contact's memberships.",
      get: "Read a contact list's metadata (ID, name and URL) by ID. This endpoint does not return participants; use list_contact_lists_for_contact for a contact's memberships.",
    },
    {
      plural: "files",
      singular: "file",
      parameter: "file_id",
      path: "files",
      list: "metadata for files already uploaded to Superchat. Use file IDs for message attachments; this does not download file contents.",
      get: "Read metadata for one uploaded file by ID. This does not download its contents.",
    },
  ] as const;
  for (const { plural, singular, parameter, path, list, get } of catalogs) {
    register(
      `list_${plural}`,
      `List one page of ${list} Use after or before to continue from a previous page; each call returns only one page.`,
      page({}),
      (query) => ({ method: "GET", path: `/${path}`, query }),
    );
    register(
      `get_${singular}`,
      get,
      z.strictObject({
        [parameter]: id.describe(
          `Superchat ${singular.replaceAll("_", " ")} ID, for example one returned by list_${plural}.`,
        ),
      }),
      (args) => ({ method: "GET", path: `/${path}/${args[parameter]}` }),
    );
  }
  register(
    "list_custom_attributes",
    "List one page of custom contact attributes with their IDs, types and allowed values. Look up an attribute ID here before searching by or updating that attribute.",
    page({}),
    (query) => ({ method: "GET", path: "/custom-attributes", query }),
  );
  register(
    "list_templates",
    "List one page of message templates. Filter by channel_id or template type, then inspect approval status and positional variables before sending a template.",
    page({
      channel_id: id
        .optional()
        .describe("Limit templates to a connected channel; discover IDs with list_channels."),
      folder_id: id.optional().describe("Limit templates to a template folder ID."),
      type: z
        .enum(["generic_template", "whats_app_template"])
        .optional()
        .describe("Limit results to generic or WhatsApp templates."),
    }),
    (query) => ({ method: "GET", path: "/templates", query }),
  );
  register(
    "get_template",
    "Read one template's content, approval status and positional variables before sending it. Use this instead of list_templates when you already have the template ID.",
    z.strictObject({
      template_id: id.describe(
        "Superchat template ID, for example one returned by list_templates.",
      ),
    }),
    ({ template_id }) => ({ method: "GET", path: `/templates/${template_id}` }),
  );
}
