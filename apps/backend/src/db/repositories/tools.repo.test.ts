import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertChain, insertMock } = vi.hoisted(() => {
  const chain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  };
  return {
    insertChain: chain,
    insertMock: vi.fn(() => chain),
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  notInArray: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("../index", () => ({
  db: {
    insert: insertMock,
  },
}));

vi.mock("../schema", () => ({
  toolsTable: {
    mcp_server_uuid: "mcp_server_uuid",
    name: "name",
  },
}));

import { toolsRepository } from "./tools.repo";

describe("ToolsRepository.bulkUpsertMany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue(insertChain);
    insertChain.values.mockReturnValue(insertChain);
    insertChain.onConflictDoUpdate.mockReturnValue(insertChain);
    insertChain.returning.mockResolvedValue([]);
  });

  it("upserts tools from multiple servers in one query", async () => {
    const result = await toolsRepository.bulkUpsertMany([
      {
        mcpServerUuid: "server-1",
        tools: [
          {
            name: "tool-a",
            description: "Tool A",
            inputSchema: { properties: { value: { type: "string" } } },
          },
        ],
      },
      {
        mcpServerUuid: "server-2",
        tools: [
          {
            name: "tool-b",
            description: "Tool B",
            inputSchema: { properties: { count: { type: "number" } } },
          },
        ],
      },
    ]);

    expect(result).toEqual([]);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertChain.values).toHaveBeenCalledWith([
      {
        name: "tool-a",
        description: "Tool A",
        annotations: null,
        _meta: null,
        toolSchema: {
          type: "object",
          properties: { value: { type: "string" } },
        },
        mcp_server_uuid: "server-1",
      },
      {
        name: "tool-b",
        description: "Tool B",
        annotations: null,
        _meta: null,
        toolSchema: {
          type: "object",
          properties: { count: { type: "number" } },
        },
        mcp_server_uuid: "server-2",
      },
    ]);
  });

  it("chunks large upserts to bound SQL parameter counts", async () => {
    const tools = Array.from({ length: 501 }, (_, index) => ({
      name: `tool-${index}`,
      inputSchema: {},
    }));

    await toolsRepository.bulkUpsertMany([
      {
        mcpServerUuid: "server-1",
        tools,
      },
    ]);

    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertChain.values).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ name: "tool-0" })]),
    );
    expect(insertChain.values.mock.calls[0][0]).toHaveLength(500);
    expect(insertChain.values.mock.calls[1][0]).toHaveLength(1);
  });

  it("does not issue a query when there are no tools", async () => {
    await expect(
      toolsRepository.bulkUpsertMany([
        { mcpServerUuid: "server-1", tools: [] },
      ]),
    ).resolves.toEqual([]);

    expect(insertMock).not.toHaveBeenCalled();
  });
});
