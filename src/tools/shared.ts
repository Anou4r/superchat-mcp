import type { McpServer, CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { SuperchatApiError, type SuperchatClient, type SuperchatRequest } from "../client.js";
import type { ServerConfig } from "../config.js";

export const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, "Use a Superchat ID, not a URL.");
export const nonempty = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Must not be blank.");
export const pageFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe(
      "Number of records in this page, from 1 to 100. Defaults to 25; the tool never fetches later pages automatically.",
    ),
  after: id
    .optional()
    .describe(
      "Fetch the page after this cursor; pass pagination.next_cursor from a previous result.",
    ),
  before: id
    .optional()
    .describe(
      "Fetch the page before this cursor; pass pagination.previous_cursor from a previous result. Cannot be combined with after.",
    ),
};

export function page<S extends z.ZodRawShape>(fields: S) {
  return z.strictObject({ ...pageFields, ...fields }).refine(
    (args) => {
      const cursors = args as { after?: unknown; before?: unknown };
      return !(cursors.after && cursors.before);
    },
    { message: "Supply after or before, not both." },
  );
}

export type Access = "read" | "write" | "delete" | "enterprise";
export type ApiClient = Pick<SuperchatClient, "request">;

export function toolRegistrar(server: McpServer, client: ApiClient, config: ServerConfig) {
  return function register<S extends z.ZodObject>(
    name: string,
    description: string,
    schema: S,
    build: (args: z.output<S>) => SuperchatRequest,
    access: Access = "read",
    destructive = access !== "read",
  ): void {
    if (access === "enterprise" && !config.enableEnterpriseTools) return;
    if ((access === "write" || access === "delete") && !config.enableWrites) return;
    if (access === "delete" && !config.enableDeletes) return;
    const inputSchema: z.ZodObject = schema;
    server.registerTool(
      `superchat_${name}`,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: access === "read" || access === "enterprise",
          destructiveHint: destructive,
          idempotentHint: access === "read" || access === "enterprise",
          openWorldHint: true,
        },
      },
      async (args, context): Promise<CallToolResult> => {
        try {
          const data = await client.request({
            ...build(args as z.output<S>),
            signal: context.mcpReq.signal,
          });
          const output = { data };
          return {
            content: [{ type: "text", text: JSON.stringify(output) }],
            structuredContent: output,
          };
        } catch (error) {
          const detail =
            error instanceof SuperchatApiError
              ? error.toJSON()
              : {
                  code: "INTERNAL_ERROR",
                  message: "The Superchat operation failed.",
                  retryable: false,
                };
          const output = { error: detail };
          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(output) }],
            structuredContent: output,
          };
        }
      },
    );
  };
}

export type RegisterTool = ReturnType<typeof toolRegistrar>;
