import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repositories", () => ({
  namespaceMappingsRepository: {
    findNamespacesByServerUuid: vi.fn(),
  },
  toolsRepository: {
    bulkUpsert: vi.fn(),
    findByMcpServerUuid: vi.fn(),
    syncTools: vi.fn(),
  },
}));

vi.mock("../lib/metamcp/metamcp-middleware/filter-tools.functional", () => ({
  clearFilterCache: vi.fn(),
}));

vi.mock("../lib/metamcp/tools-sync-cache", () => ({
  toolsSyncCache: {
    hashTools: vi.fn(),
    hasHashChanged: vi.fn(),
    updateHash: vi.fn(),
  },
}));

import {
  namespaceMappingsRepository,
  toolsRepository,
} from "../db/repositories";
import { clearFilterCache } from "../lib/metamcp/metamcp-middleware/filter-tools.functional";
import { toolsSyncCache } from "../lib/metamcp/tools-sync-cache";
import { toolsImplementations } from "./tools.impl";

const serverUuid = "server-uuid";

const input = {
  mcpServerUuid: serverUuid,
  tools: [
    {
      name: "sample-tool",
      description: "Sample tool",
      inputSchema: { type: "object", properties: {} },
    },
  ],
} satisfies Parameters<typeof toolsImplementations.sync>[0];

describe("toolsImplementations.sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(toolsSyncCache.hashTools).mockReturnValue("tools-hash");
    vi.mocked(toolsSyncCache.hasHashChanged).mockReturnValue(true);
    vi.mocked(toolsRepository.syncTools).mockResolvedValue({
      upserted: [],
      deleted: [],
    });
    vi.mocked(
      namespaceMappingsRepository.findNamespacesByServerUuid,
    ).mockResolvedValue(["namespace-a", "namespace-b"]);
  });

  it("invalidates filter caches for namespaces using a changed server", async () => {
    const result = await toolsImplementations.sync(input);

    expect(result.success).toBe(true);
    expect(
      namespaceMappingsRepository.findNamespacesByServerUuid,
    ).toHaveBeenCalledWith(serverUuid);
    expect(clearFilterCache).toHaveBeenNthCalledWith(1, "namespace-a");
    expect(clearFilterCache).toHaveBeenNthCalledWith(2, "namespace-b");
  });

  it("keeps a successful sync successful if cache invalidation fails", async () => {
    vi.mocked(
      namespaceMappingsRepository.findNamespacesByServerUuid,
    ).mockRejectedValue(new Error("database unavailable"));

    const result = await toolsImplementations.sync(input);

    expect(result.success).toBe(true);
    expect(clearFilterCache).not.toHaveBeenCalled();
  });

  it("does not query namespaces when the tool hash is unchanged", async () => {
    vi.mocked(toolsSyncCache.hasHashChanged).mockReturnValue(false);

    const result = await toolsImplementations.sync(input);

    expect(result.success).toBe(true);
    expect(
      namespaceMappingsRepository.findNamespacesByServerUuid,
    ).not.toHaveBeenCalled();
    expect(clearFilterCache).not.toHaveBeenCalled();
  });
});
