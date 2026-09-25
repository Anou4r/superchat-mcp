import { z } from "zod/v4";
import { id, nonempty, page, type RegisterTool } from "./shared.js";

const gender = z.enum(["male", "female", "diverse", "unknown"]).nullable();
const handle = z.strictObject({
  id: id.nullable().default(null).describe("Existing handle ID; null creates a new handle."),
  type: z
    .enum(["mail", "phone"])
    .describe("Handle type accepted for contact creation and updates."),
  value: nonempty.describe("Email address or phone number for this handle."),
});
const attribute = z.strictObject({
  id: id.describe(
    "Existing custom contact attribute ID; discover IDs with list_custom_attributes.",
  ),
  value: z
    .union([z.string(), z.number(), z.array(z.string())])
    .optional()
    .describe("Value to store for this contact attribute."),
});

export function registerContactTools(register: RegisterTool): void {
  register(
    "list_contacts",
    "List one page of contacts, newest first. For an exact email, phone, Instagram or custom-attribute match, use search_contacts instead of scanning pages.",
    page({}),
    (query) => ({ method: "GET", path: "/contacts", query }),
  );
  register(
    "get_contact",
    "Read one contact's details, handles and custom attributes by ID. Use this before update_contact because supplied handle and attribute arrays replace their full lists.",
    z.strictObject({
      contact_id: id.describe(
        "Superchat contact ID, for example one returned by list_contacts or search_contacts.",
      ),
    }),
    ({ contact_id }) => ({ method: "GET", path: `/contacts/${contact_id}` }),
  );
  register(
    "search_contacts",
    "Find contacts with one exact equality match on email, phone, Instagram ID or a custom attribute. This is a read-only POST; it does not support fuzzy name search or combining conditions. Use list_contacts to browse instead.",
    page({
      field: z
        .enum(["mail", "phone", "instagram", "custom_attribute"])
        .describe("The single field to match: mail, phone, instagram, or custom_attribute."),
      value: z
        .union([nonempty, z.number(), z.array(z.string())])
        .describe(
          "Exact value to match. Handle fields require a string; custom attributes may use a string, number or list of strings.",
        ),
      identifier: nonempty
        .optional()
        .describe(
          "Required only for custom_attribute: attribute ID or built-in attribute name. Get custom attribute IDs with list_custom_attributes.",
        ),
    })
      .refine((args) => args.field !== "custom_attribute" || args.identifier !== undefined, {
        message: "custom_attribute requires identifier.",
      })
      .refine((args) => args.field === "custom_attribute" || typeof args.value === "string", {
        message: "Contact handles require a string value.",
      })
      .refine((args) => args.field === "custom_attribute" || args.identifier === undefined, {
        message: "identifier is only used for custom_attribute.",
      }),
    ({ field, value, identifier, ...query }) => ({
      method: "POST",
      path: "/contacts/search",
      query,
      body: {
        query: { value: [{ field, operator: "=", value, ...(identifier ? { identifier } : {}) }] },
      },
    }),
  );
  register(
    "list_contact_conversations",
    "List one page of conversation threads for a contact across its channels. Results are conversation records, not message history; use list_conversation_messages for messages when Enterprise access is enabled.",
    page({ contact_id: id.describe("Superchat contact ID whose conversation threads to list.") }),
    ({ contact_id, ...query }) => ({
      method: "GET",
      path: `/contacts/${contact_id}/conversations`,
      query,
    }),
  );
  register(
    "list_contact_lists_for_contact",
    "List one page of contact lists that contain this contact. Use this to inspect membership; list_contact_lists and get_contact_list return only list metadata, not participants.",
    page({ contact_id: id.describe("Superchat contact ID whose list memberships to retrieve.") }),
    ({ contact_id, ...query }) => ({
      method: "GET",
      path: `/contacts/${contact_id}/contact-lists`,
      query,
    }),
  );

  register(
    "add_contact_to_contact_list",
    "Add this contact to one contact list for segmentation or campaign audiences. This changes list membership only; it does not create a contact list. Find the list ID with list_contact_lists and inspect current membership with list_contact_lists_for_contact.",
    z.strictObject({
      contact_id: id.describe("Superchat contact ID to add."),
      contact_list_id: id.describe(
        "Existing contact list ID; discover it with list_contact_lists.",
      ),
    }),
    ({ contact_id, contact_list_id }) => ({
      method: "POST",
      path: `/contacts/${contact_id}/contact-lists`,
      body: { id: contact_list_id },
    }),
    "write",
    false,
  );

  register(
    "remove_contact_from_contact_list",
    "Remove one contact from one contact list. This deletes the membership only; the contact and list remain. Use only when the user asks to remove that membership.",
    z.strictObject({
      contact_id: id.describe("Superchat contact ID to remove from the list."),
      contact_list_id: id.describe("Contact list ID to remove the contact from."),
    }),
    ({ contact_id, contact_list_id }) => ({
      method: "DELETE",
      path: `/contacts/${contact_id}/contact-lists/${contact_list_id}`,
    }),
    "delete",
  );

  register(
    "create_contact",
    "Create a Superchat contact for one person. Supply at least one email or phone handle; Superchat generates the contact ID. Search first to avoid duplicates. Other channel handles are assigned by their platforms and cannot be created through this API.",
    z.strictObject({
      first_name: z
        .string()
        .nullable()
        .default(null)
        .describe("Optional contact first name; null leaves it unset."),
      last_name: z
        .string()
        .nullable()
        .default(null)
        .describe("Optional contact last name; null leaves it unset."),
      gender: gender.default(null).describe("Optional contact gender; null leaves it unset."),
      handles: z
        .array(handle)
        .min(1)
        .describe(
          "At least one email or phone handle is required. A contact may have multiple handles.",
        ),
      custom_attributes: z
        .array(attribute)
        .optional()
        .describe("Optional values for custom attributes already defined in this workspace."),
    }),
    (body) => ({ method: "POST", path: "/contacts", body }),
    "write",
    false,
  );

  register(
    "update_contact",
    "Update a contact's name, gender, handles or custom attributes. The API requires first_name, last_name and gender on every update: read the contact first and pass back values to preserve. Supplied handles and custom_attributes replace their entire lists; omit a list to leave it unchanged. Null name or gender values clear those fields.",
    z.strictObject({
      contact_id: id.describe("Superchat contact ID to update."),
      first_name: z
        .string()
        .nullable()
        .describe("New first name; required by the API. Null clears it."),
      last_name: z
        .string()
        .nullable()
        .describe("New last name; required by the API. Null clears it."),
      gender: gender.describe("New gender; required by the API. Null clears it."),
      handles: z
        .array(handle)
        .min(1)
        .optional()
        .describe(
          "Complete replacement handle list. Omit to keep current handles; at least one handle is required if supplied.",
        ),
      custom_attributes: z
        .array(attribute)
        .optional()
        .describe(
          "Complete replacement custom-attribute list. Omit to keep current values; use [] to clear them.",
        ),
    }),
    ({ contact_id, ...body }) => ({ method: "PATCH", path: `/contacts/${contact_id}`, body }),
    "write",
  );
  register(
    "delete_contact",
    "Permanently delete a contact and its contact record. This does not mean removing a contact from a contact list; use remove_contact_from_contact_list for that. Only use when the user explicitly requests contact deletion.",
    z.strictObject({ contact_id: id.describe("Superchat contact ID to permanently delete.") }),
    ({ contact_id }) => ({ method: "DELETE", path: `/contacts/${contact_id}` }),
    "delete",
  );
}
