import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, selectMock } = vi.hoisted(() => {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  return {
    query,
    selectMock: vi.fn(() => query),
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  or: vi.fn(),
}));

vi.mock("pg", () => ({
  DatabaseError: class DatabaseError extends Error {},
}));

vi.mock("../index", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("../schema", () => ({
  mcpServersTable: {
    created_at: "created_at",
    type: "type",
    url: "url",
  },
}));

vi.mock("@/utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { mcpServersRepository } from "./mcp-servers.repo";

describe("McpServersRepository.findByTypeAndUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
  });

  it("queries only the requested transport and URL", async () => {
    const server = {
      uuid: "server-1",
      type: "SSE",
      url: "https://example.com/mcp",
    };
    query.limit.mockResolvedValue([server]);

    await expect(
      mcpServersRepository.findByTypeAndUrl("SSE", server.url),
    ).resolves.toEqual(server);

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.orderBy).toHaveBeenCalledTimes(1);
    expect(query.limit).toHaveBeenCalledWith(1);
  });
});
