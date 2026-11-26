import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { METAMCP_HOSTS } from "./hosts";
import { createMetaMcpOpsRouter } from "./server";

const TEST_API_KEY = "test-metamcp-ops-api-key";

async function startServer(app: express.Express) {
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("MetaMCP operations MCP", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("restricts management to the three fixed hosts", () => {
    expect(Object.keys(METAMCP_HOSTS)).toEqual(["vps", "arch", "omarchy"]);
    expect(
      Object.values(METAMCP_HOSTS).every(
        (host) => host.container === "metamcp",
      ),
    ).toBe(true);
  });

  it("keeps health public and rejects unauthenticated MCP requests", async () => {
    vi.stubEnv("METAMCP_OPS_API_KEY", TEST_API_KEY);
    vi.stubEnv("METAMCP_OPS_TRUSTED_IPS", "192.0.2.10");
    const app = express();
    app.use(express.json());
    app.use(createMetaMcpOpsRouter());
    const { server, baseUrl } = await startServer(app);

    try {
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        sessions: {
          active: 0,
          max: 100,
          available: 100,
          atCapacity: false,
          idleTimeoutMs: 15 * 60 * 1000,
        },
      });
      const unauthorized = await fetch(`${baseUrl}/mcp`, { method: "POST" });
      expect(unauthorized.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("allows the trusted MetaMCP container IP without a bearer token", async () => {
    vi.stubEnv("METAMCP_OPS_API_KEY", TEST_API_KEY);
    vi.stubEnv("METAMCP_OPS_TRUSTED_IPS", "127.0.0.1");
    const app = express();
    app.use(express.json());
    app.use(createMetaMcpOpsRouter());
    const { server, baseUrl } = await startServer(app);
    const client = new Client({
      name: "metamcp-ops-internal-test",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
    );

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain(
        "metamcp_ops_get_host_status",
      );
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("reclaims idle sessions before enforcing the session cap", async () => {
    vi.stubEnv("METAMCP_OPS_API_KEY", TEST_API_KEY);
    vi.stubEnv("METAMCP_OPS_MAX_SESSIONS", "1");
    vi.stubEnv("METAMCP_OPS_SESSION_IDLE_TIMEOUT_MS", "1000");
    const app = express();
    app.use(express.json());
    app.use(createMetaMcpOpsRouter());
    const { server, baseUrl } = await startServer(app);
    const initializeRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "metamcp-ops-idle-test", version: "1.0.0" },
      },
    };
    const requestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initializeRequest),
    };

    try {
      const firstResponse = await fetch(`${baseUrl}/mcp`, requestInit);
      expect(firstResponse.status).toBe(200);
      const firstSessionId = firstResponse.headers.get("mcp-session-id");
      expect(firstSessionId).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 1100));
      const healthResponse = await fetch(baseUrl + "/health");
      expect(await healthResponse.json()).toMatchObject({
        sessions: {
          active: 0,
          max: 1,
          available: 1,
          atCapacity: false,
        },
      });
      const secondResponse = await fetch(`${baseUrl}/mcp`, requestInit);
      expect(secondResponse.status).toBe(200);
      expect(secondResponse.headers.get("mcp-session-id")).not.toBe(
        firstSessionId,
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("advertises the management tools and enforces action confirmation over MCP", async () => {
    vi.stubEnv("METAMCP_OPS_API_KEY", TEST_API_KEY);
    const app = express();
    app.use(express.json());
    app.use(createMetaMcpOpsRouter());
    const { server, baseUrl } = await startServer(app);
    const client = new Client({ name: "metamcp-ops-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        },
      },
    );

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "metamcp_ops_list_hosts",
        "metamcp_ops_get_host_status",
        "metamcp_ops_get_container_logs",
        "metamcp_ops_container_action",
        "metamcp_ops_reload_compose_service",
      ]);

      const result = await client.callTool({
        name: "metamcp_ops_container_action",
        arguments: { host: "vps", action: "restart", confirm: "no" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
