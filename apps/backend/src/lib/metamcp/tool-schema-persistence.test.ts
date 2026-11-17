import {
  CreateToolRequestSchema,
  DatabaseToolSchema,
  ToolUpsertInputSchema,
} from "@repo/zod-types";
import { describe, expect, it } from "vitest";

describe("tool schema persistence", () => {
  const extendedSchema = {
    type: "object" as const,
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
    $defs: { query: { minLength: 2 } },
    oneOf: [{ required: ["query"] }],
  };

  it("retains extended JSON Schema keywords during tool sync parsing", () => {
    const parsed = ToolUpsertInputSchema.parse({
      mcpServerUuid: "server-uuid",
      tools: [{ name: "search", inputSchema: extendedSchema }],
    });

    expect(parsed.tools[0].inputSchema).toEqual(extendedSchema);
  });

  it("retains MCP Apps metadata in the sync implementation input", () => {
    const appMetadata = {
      ui: { resourceUri: "ui://skilljack/configuration.html" },
    };
    const parsed = CreateToolRequestSchema.parse({
      mcpServerUuid: "00000000-0000-4000-8000-000000000001",
      tools: [
        {
          name: "skill_config",
          inputSchema: extendedSchema,
          _meta: appMetadata,
        },
      ],
    });

    expect(parsed.tools[0]._meta).toEqual(appMetadata);
  });

  it("retains MCP Apps metadata during tool sync parsing", () => {
    const appMetadata = {
      ui: { resourceUri: "ui://skilljack/configuration.html" },
    };
    const parsed = ToolUpsertInputSchema.parse({
      mcpServerUuid: "server-uuid",
      tools: [
        {
          name: "skill_config",
          inputSchema: extendedSchema,
          _meta: appMetadata,
        },
      ],
    });

    expect(parsed.tools[0]._meta).toEqual(appMetadata);
  });

  it("retains extended JSON Schema keywords when reading persisted tools", () => {
    const appMetadata = {
      ui: { resourceUri: "ui://skilljack/configuration.html" },
    };
    const parsed = DatabaseToolSchema.parse({
      uuid: "tool-uuid",
      name: "search",
      description: "Search records",
      annotations: { readOnlyHint: true },
      _meta: appMetadata,
      toolSchema: extendedSchema,
      created_at: new Date(),
      updated_at: new Date(),
      mcp_server_uuid: "server-uuid",
    });

    expect(parsed.toolSchema).toEqual(extendedSchema);
    expect(parsed._meta).toEqual(appMetadata);
  });
});
