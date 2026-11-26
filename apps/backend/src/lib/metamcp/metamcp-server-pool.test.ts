import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type MetaMcpServerInstance,
  MetaMcpServerPool,
} from "./metamcp-server-pool";

const { cleanupSession, cleanupAll } = vi.hoisted(() => ({
  cleanupSession: vi.fn().mockResolvedValue(undefined),
  cleanupAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./mcp-server-pool", () => ({
  mcpServerPool: {
    cleanupSession,
    cleanupAll,
    getPoolStatus: vi.fn(() => ({
      idle: 0,
      active: 0,
      pending: 0,
      maxTotalConnections: 100,
      activeSessionIds: [],
      idleServerUuids: [],
      perServerCounts: {},
      maxConnectionsPerServer: 5,
    })),
  },
}));

vi.mock("../config.service", () => ({
  configService: { getSessionLifetime: vi.fn().mockResolvedValue(60_000) },
}));

vi.mock("./fetch-metamcp", () => ({
  getMcpServers: vi.fn().mockResolvedValue([]),
}));

vi.mock("./metamcp-proxy", () => ({
  createServer: vi.fn(),
}));

vi.mock("./header-forwarding", () => ({
  anyServerRequiresForwardedHeaders: vi.fn().mockResolvedValue(false),
}));

vi.mock("../admin-mcp/admin-session-context", () => ({
  clearAdminToolsContext: vi.fn(),
  setAdminToolsContext: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const PoolConstructor =
  MetaMcpServerPool as unknown as new () => MetaMcpServerPool;

describe("MetaMcpServerPool cleanup", () => {
  let pool: MetaMcpServerPool;

  afterEach(async () => {
    await pool.cleanupAll();
    cleanupSession.mockClear();
    cleanupAll.mockClear();
  });

  it("cleans the backend pool even when MetaMCP server cleanup fails", async () => {
    pool = new PoolConstructor();
    const cleanup = vi
      .fn()
      .mockRejectedValue(new Error("MetaMCP close failed"));
    const server = {
      cleanup,
      internalSessionId: "internal-a",
    } as unknown as MetaMcpServerInstance;
    const state = pool as unknown as {
      activeServers: Record<string, MetaMcpServerInstance>;
      sessionTimestamps: Record<string, number>;
      sessionCreatedAt: Record<string, number>;
    };
    state.activeServers["session-a"] = server;
    state.sessionTimestamps["session-a"] = Date.now();
    state.sessionCreatedAt["session-a"] = Date.now();

    await expect(pool.cleanupSession("session-a")).rejects.toThrow(
      "MetaMCP close failed",
    );

    expect(cleanupSession).toHaveBeenCalledWith("internal-a");
    expect(pool.getPoolStatus().active).toBe(0);
  });

  it("detaches a session before awaiting cleanup so concurrent callers close it once", async () => {
    pool = new PoolConstructor();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const server = {
      cleanup,
      internalSessionId: "internal-a",
    } as unknown as MetaMcpServerInstance;
    const state = pool as unknown as {
      activeServers: Record<string, MetaMcpServerInstance>;
      sessionTimestamps: Record<string, number>;
      sessionCreatedAt: Record<string, number>;
    };
    state.activeServers["session-a"] = server;
    state.sessionTimestamps["session-a"] = Date.now();
    state.sessionCreatedAt["session-a"] = Date.now();

    await Promise.all([
      pool.cleanupSession("session-a"),
      pool.cleanupSession("session-a"),
    ]);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanupSession).toHaveBeenCalledTimes(1);
    expect(pool.getPoolStatus().active).toBe(0);
    expect(pool.getPoolStatus().activeSessionAges.count).toBe(0);
  });
});
