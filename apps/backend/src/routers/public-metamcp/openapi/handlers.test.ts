import type { ServerParameters } from "@repo/zod-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({ default: { error: vi.fn() } }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/config.service", () => ({
  configService: { getMcpExecutionConfig: vi.fn() },
}));
vi.mock("@/lib/metamcp/fetch-metamcp", () => ({ getMcpServers: vi.fn() }));
vi.mock("@/lib/metamcp/mcp-server-pool", () => ({
  mcpServerPool: { getSession: vi.fn() },
}));
vi.mock("@/lib/metamcp/metamcp-middleware/audit-requests.functional", () => ({
  createAuditCallToolMiddleware: vi.fn(),
}));
vi.mock("@/lib/metamcp/metamcp-middleware/filter-tools.functional", () => ({
  createFilterCallToolMiddleware: vi.fn(),
  createFilterListToolsMiddleware: vi.fn(),
}));
vi.mock("@/lib/metamcp/metamcp-middleware/tool-overrides.functional", () => ({
  createToolOverridesCallToolMiddleware: vi.fn(),
  createToolOverridesListToolsMiddleware: vi.fn(),
}));
vi.mock("@/lib/metamcp/metamcp-middleware/tool-identity", () => ({
  createToolIdentityResolver: vi.fn(),
}));

import { configService } from "@/lib/config.service";
import type { ConnectedClient } from "@/lib/metamcp/client";
import { getMcpServers } from "@/lib/metamcp/fetch-metamcp";
import { mcpServerPool } from "@/lib/metamcp/mcp-server-pool";
import type { MetaMCPHandlerContext } from "@/lib/metamcp/metamcp-middleware/functional-middleware";

import {
  createOriginalCallToolHandler,
  createOriginalListToolsHandler,
} from "./handlers";

const targetParams = {
  uuid: "uuid-5000",
  name: "server-5000",
  description: "",
  created_at: "2026-01-01T00:00:00Z",
  status: "active",
} as ServerParameters;

const makeSession = (): ConnectedClient => {
  const client = {
    getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
    getServerVersion: vi.fn().mockReturnValue({ name: "server-5000" }),
    request: vi
      .fn()
      .mockImplementation(async (request: { method: string }) =>
        request.method === "tools/list"
          ? { tools: [{ name: "list_events" }] }
          : { content: [{ type: "text", text: "ok" }] },
      ),
  };
  return { client } as unknown as ConnectedClient;
};

describe("OpenAPI tool routing cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configService.getMcpExecutionConfig).mockResolvedValue({
      resetTimeoutOnProgress: true,
      timeout: 1000,
      maxTotalTimeout: 1000,
    });
  });

  it("routes a mapped tool through one pool lookup with 10,000 servers", async () => {
    const session = makeSession();
    const largeServerSet = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [
        "uuid-" + index,
        { ...targetParams, uuid: "uuid-" + index, name: "server-" + index },
      ]),
    ) as Awaited<ReturnType<typeof getMcpServers>>;
    largeServerSet[targetParams.uuid] = targetParams;

    vi.mocked(getMcpServers)
      .mockResolvedValueOnce({ [targetParams.uuid]: targetParams })
      .mockResolvedValueOnce(largeServerSet);
    vi.mocked(mcpServerPool.getSession).mockResolvedValue(session);

    const routingCache = {
      toolToServerUuid: {} as Record<string, string>,
      serverNameByUuid: new Map<string, string>(),
    };
    const context = {
      namespaceUuid: "namespace-1",
      sessionId: "session-1",
    } as MetaMCPHandlerContext;

    const listHandler = createOriginalListToolsHandler(false, routingCache);
    await listHandler(
      { method: "tools/list", params: {} } as Parameters<
        ReturnType<typeof createOriginalListToolsHandler>
      >[0],
      context,
    );

    expect(routingCache.toolToServerUuid["server-5000__list_events"]).toBe(
      targetParams.uuid,
    );
    expect(routingCache.serverNameByUuid.get(targetParams.uuid)).toBe(
      targetParams.name,
    );
    expect(configService.getMcpExecutionConfig).toHaveBeenCalledTimes(1);

    vi.mocked(mcpServerPool.getSession).mockClear();
    const callHandler = createOriginalCallToolHandler(routingCache);
    await callHandler(
      {
        method: "tools/call",
        params: { name: "server-5000__list_events", arguments: {} },
      } as Parameters<ReturnType<typeof createOriginalCallToolHandler>>[0],
      context,
    );

    expect(mcpServerPool.getSession).toHaveBeenCalledTimes(1);
    expect(mcpServerPool.getSession).toHaveBeenCalledWith(
      context.sessionId,
      targetParams.uuid,
      targetParams,
      context.namespaceUuid,
    );
    expect(getMcpServers).toHaveBeenCalledTimes(2);
    expect(getMcpServers).toHaveBeenNthCalledWith(
      2,
      context.namespaceUuid,
      false,
      targetParams.uuid,
    );
    expect(configService.getMcpExecutionConfig).toHaveBeenCalledTimes(2);
  });
});
