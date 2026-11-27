import { afterEach, describe, expect, it, vi } from "vitest";

const mcpServerMocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../trpc/mcp-servers.impl", () => ({
  mcpServersImplementations: mcpServerMocks,
}));

import { McpServerSchema } from "@repo/zod-types";

import { ADMIN_TOOLS } from "./tools-registry";

const userScopedToolNames = [
  "metamcp_create_mcp_server",
  "metamcp_update_mcp_server",
  "metamcp_create_namespace",
  "metamcp_update_namespace",
  "metamcp_create_endpoint",
  "metamcp_update_endpoint",
  "metamcp_create_api_key",
];

function getAdminTool(name: string) {
  const tool = ADMIN_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Admin tool not found: ${name}`);
  return tool;
}

const publicServer = McpServerSchema.parse({
  uuid: "00000000-0000-4000-8000-000000000001",
  name: "shared-server",
  description: null,
  type: "STDIO",
  command: "node",
  args: [],
  env: {},
  url: null,
  created_at: "2026-11-27T00:00:00.000Z",
  bearerToken: null,
  headers: {},
  forward_headers: {},
  user_id: null,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MetaMCP admin tool ownership", () => {
  it.each(userScopedToolNames)("does not expose user_id on %s", (name) => {
    const tool = getAdminTool(name);
    const properties = tool.inputSchema.properties as
      | Record<string, unknown>
      | undefined;

    expect(properties).not.toHaveProperty("user_id");
  });

  it("creates MCP servers under the authenticated user's ownership", async () => {
    mcpServerMocks.create.mockResolvedValue({
      success: false,
      message: "mock response",
    });

    await getAdminTool("metamcp_create_mcp_server").handler("owner-id", {
      name: "probe",
      type: "STDIO",
      command: "/bin/sh",
      args: ["-c", "id"],
    });

    expect(mcpServerMocks.create).toHaveBeenCalledOnce();
    expect(mcpServerMocks.create.mock.calls[0][0]).not.toHaveProperty(
      "user_id",
    );
    expect(mcpServerMocks.create.mock.calls[0][1]).toBe("owner-id");
  });

  it("does not allow updating a public MCP server", async () => {
    mcpServerMocks.get.mockResolvedValue({
      success: true,
      data: publicServer,
    });

    const result = await getAdminTool("metamcp_update_mcp_server").handler(
      "owner-id",
      {
        uuid: publicServer.uuid,
        name: "renamed-server",
        type: "STDIO",
        command: "node",
        user_id: "owner-id",
      },
    );

    expect(result).toMatchObject({ success: false });
    expect(mcpServerMocks.update).not.toHaveBeenCalled();
  });

  it("does not allow deleting a public MCP server", async () => {
    mcpServerMocks.get.mockResolvedValue({
      success: true,
      data: publicServer,
    });

    const result = await getAdminTool("metamcp_delete_mcp_server").handler(
      "owner-id",
      { uuid: publicServer.uuid },
    );

    expect(result).toMatchObject({ success: false });
    expect(mcpServerMocks.delete).not.toHaveBeenCalled();
  });
});
