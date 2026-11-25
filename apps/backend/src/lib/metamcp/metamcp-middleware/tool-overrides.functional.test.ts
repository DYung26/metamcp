import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({
  query: {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNotNull: vi.fn(),
}));

vi.mock("../../../db/schema", () => ({
  mcpServersTable: { name: "server_name" },
  namespaceToolMappingsTable: {
    namespace_uuid: "namespace_uuid",
    override_name: "override_name",
    tool_uuid: "tool_uuid",
    mcp_server_uuid: "mcp_server_uuid",
  },
  toolsTable: { name: "tool_name", uuid: "tool_uuid" },
}));

vi.mock("../../../db", () => ({
  db: {
    select: vi.fn(() => query),
  },
}));

vi.mock("../../../db/repositories", () => ({
  mcpServersRepository: {},
  namespaceToolMappingsRepository: {},
  toolsRepository: {},
}));

vi.mock("@/utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { db } from "../../../db";
import {
  clearOverrideCache,
  mapOverrideNamesToOriginal,
} from "./tool-overrides.functional";

describe("mapOverrideNamesToOriginal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    clearOverrideCache();
  });

  it("resolves many tool aliases with one namespace query", async () => {
    query.where.mockResolvedValue([
      {
        originalName: "original-tool",
        serverName: "server",
        overrideName: "renamed-tool",
      },
    ]);

    const result = await mapOverrideNamesToOriginal(
      ["server__renamed-tool", "server__original-tool", "invalid-name"],
      "namespace-1",
    );

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(result.get("server__renamed-tool")).toBe("server__original-tool");
    expect(result.get("server__original-tool")).toBe("server__original-tool");
    expect(result.get("invalid-name")).toBe("invalid-name");
  });

  it("uses cached alias mappings without another database query", async () => {
    query.where.mockResolvedValue([
      {
        originalName: "original-tool",
        serverName: "server",
        overrideName: "renamed-tool",
      },
    ]);

    await mapOverrideNamesToOriginal(["server__renamed-tool"], "namespace-1");
    const result = await mapOverrideNamesToOriginal(
      ["server__renamed-tool"],
      "namespace-1",
    );

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(result.get("server__renamed-tool")).toBe("server__original-tool");
  });

  it("keeps same override names isolated across different servers", async () => {
    query.where.mockResolvedValue([
      {
        originalName: "first-original",
        serverName: "first-server",
        overrideName: "shared-alias",
      },
      {
        originalName: "second-original",
        serverName: "second-server",
        overrideName: "shared-alias",
      },
    ]);

    const toolNames = [
      "first-server__shared-alias",
      "second-server__shared-alias",
    ];
    const firstResult = await mapOverrideNamesToOriginal(
      toolNames,
      "namespace-1",
    );
    const secondResult = await mapOverrideNamesToOriginal(
      toolNames,
      "namespace-1",
    );

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(firstResult.get(toolNames[0])).toBe("first-server__first-original");
    expect(firstResult.get(toolNames[1])).toBe("second-server__second-original");
    expect(secondResult).toEqual(firstResult);
  });

  it("returns unchanged names if the batch query fails", async () => {
    query.where.mockRejectedValue(new Error("database unavailable"));

    const result = await mapOverrideNamesToOriginal(
      ["server__tool"],
      "namespace-1",
    );

    expect(result.get("server__tool")).toBe("server__tool");
  });

  it("does not query the database for an empty list", async () => {
    await expect(
      mapOverrideNamesToOriginal([], "namespace-1"),
    ).resolves.toEqual(new Map());
    expect(db.select).not.toHaveBeenCalled();
  });
});
