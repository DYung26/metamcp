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
  sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("../index", () => ({
  db: {
    insert: insertMock,
  },
}));

vi.mock("../schema", () => ({
  namespaceServerMappingsTable: {},
  namespaceToolMappingsTable: {
    namespace_uuid: "namespace_uuid",
    tool_uuid: "tool_uuid",
    mcp_server_uuid: "mcp_server_uuid",
  },
}));

import { namespaceMappingsRepository } from "./namespace-mappings.repo";

describe("NamespaceMappingsRepository.bulkUpsertNamespaceToolMappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue(insertChain);
    insertChain.values.mockReturnValue(insertChain);
    insertChain.onConflictDoUpdate.mockReturnValue(insertChain);
    insertChain.returning.mockResolvedValue([]);
  });

  it("chunks large mapping upserts to bound SQL parameter counts", async () => {
    const toolMappings = Array.from({ length: 1_001 }, (_, index) => ({
      toolUuid: `tool-${index}`,
      serverUuid: "server-1",
    }));

    await namespaceMappingsRepository.bulkUpsertNamespaceToolMappings({
      namespaceUuid: "namespace-1",
      toolMappings,
    });

    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertChain.values.mock.calls[0][0]).toHaveLength(1_000);
    expect(insertChain.values.mock.calls[1][0]).toHaveLength(1);
  });

  it("does not issue a query for an empty mapping list", async () => {
    await expect(
      namespaceMappingsRepository.bulkUpsertNamespaceToolMappings({
        namespaceUuid: "namespace-1",
        toolMappings: [],
      }),
    ).resolves.toEqual([]);

    expect(insertMock).not.toHaveBeenCalled();
  });
});
