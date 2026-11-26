import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repositories", () => ({
  mcpServersRepository: {},
  namespaceMappingsRepository: {
    updateToolStatus: vi.fn(),
  },
  namespacesRepository: {
    findByUuid: vi.fn(),
  },
  toolsRepository: {},
}));

vi.mock("../db/serializers", () => ({
  NamespacesSerializer: {},
}));

vi.mock("../lib/metamcp/metamcp-middleware/filter-tools.functional", () => ({
  clearFilterCache: vi.fn(),
}));

vi.mock("../lib/metamcp/metamcp-middleware/tool-overrides.functional", () => ({
  clearOverrideCache: vi.fn(),
  mapOverrideNamesToOriginal: vi.fn(),
}));

vi.mock("../lib/metamcp/metamcp-server-pool", () => ({
  metaMcpServerPool: {},
}));

import {
  namespaceMappingsRepository,
  namespacesRepository,
} from "../db/repositories";
import { clearFilterCache } from "../lib/metamcp/metamcp-middleware/filter-tools.functional";
import { namespacesImplementations } from "./namespaces.impl";

const input = {
  namespaceUuid: "namespace-a",
  toolUuid: "tool-a",
  serverUuid: "server-a",
  status: "INACTIVE",
} satisfies Parameters<typeof namespacesImplementations.updateToolStatus>[0];

describe("namespacesImplementations.updateToolStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValue({
      uuid: input.namespaceUuid,
      name: "namespace-a",
      description: null,
      tool_partition_count: 1,
      created_at: new Date(),
      updated_at: new Date(),
      user_id: "user-a",
    });
    vi.mocked(namespaceMappingsRepository.updateToolStatus).mockResolvedValue({
      uuid: "mapping-a",
      namespace_uuid: input.namespaceUuid,
      tool_uuid: input.toolUuid,
      mcp_server_uuid: input.serverUuid,
      status: input.status,
      override_name: null,
      override_title: null,
      override_description: null,
      override_annotations: null,
      created_at: new Date(),
    });
  });

  it("invalidates the namespace filter cache after a successful update", async () => {
    const result = await namespacesImplementations.updateToolStatus(
      input,
      "user-a",
    );

    expect(result.success).toBe(true);
    expect(clearFilterCache).toHaveBeenCalledWith(input.namespaceUuid);
  });

  it("does not invalidate the cache when no mapping was updated", async () => {
    vi.mocked(namespaceMappingsRepository.updateToolStatus).mockResolvedValue(
      undefined,
    );

    const result = await namespacesImplementations.updateToolStatus(
      input,
      "user-a",
    );

    expect(result.success).toBe(false);
    expect(clearFilterCache).not.toHaveBeenCalled();
  });
});
