import { describe, expect, it, vi, afterEach } from "vitest";
import express from "express";

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
    expect(Object.values(METAMCP_HOSTS).every((host) => host.container === "metamcp")).toBe(true);
  });

  it("keeps health public and rejects unauthenticated MCP requests", async () => {
    vi.stubEnv("METAMCP_OPS_API_KEY", TEST_API_KEY);
    const app = express();
    app.use(express.json());
    app.use(createMetaMcpOpsRouter());
    const { server, baseUrl } = await startServer(app);

    try {
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      const unauthorized = await fetch(`${baseUrl}/mcp`, { method: "POST" });
      expect(unauthorized.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
