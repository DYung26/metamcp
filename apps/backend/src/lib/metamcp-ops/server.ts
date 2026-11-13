import { randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

import { METAMCP_HOSTS, type MetaMcpHostId } from "./hosts";
import {
  checkHostHealth,
  getContainerLogs,
  inspectContainer,
  performContainerAction,
  reloadComposeService,
} from "./remote";

const CONFIRMATION_PHRASE = "CONFIRM_METAMCP_OPERATION";
const HOST_SCHEMA = z.enum(["vps", "arch", "omarchy"]);
const ACTION_SCHEMA = z.enum(["start", "stop", "restart"]);
const MAX_SESSIONS = 100;

function createMetaMcpOpsServer() {
  const server = new McpServer({ name: "metamcp-ops", version: "1.0.0" });

  server.registerTool(
    "metamcp_ops_list_hosts",
    {
      description:
        "List the fixed MetaMCP hosts managed by this control plane.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            Object.entries(METAMCP_HOSTS).map(([id, host]) => ({
              id,
              label: host.label,
              url: host.url,
              container: host.container,
              composeProject: host.composeProject,
              composeService: host.composeService,
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "metamcp_ops_get_host_status",
    {
      description:
        "Check public health and Docker container state for one or all managed MetaMCP hosts.",
      inputSchema: {
        host: HOST_SCHEMA.optional().describe(
          "Managed host. Omit to inspect all hosts.",
        ),
      },
    },
    async ({ host }) => {
      const hostIds = host
        ? [host]
        : (Object.keys(METAMCP_HOSTS) as MetaMcpHostId[]);
      const results = await Promise.all(
        hostIds.map(async (hostId) => {
          const [health, container] = await Promise.allSettled([
            checkHostHealth(hostId),
            inspectContainer(hostId),
          ]);
          return {
            host: hostId,
            health:
              health.status === "fulfilled"
                ? health.value
                : {
                    error:
                      health.reason instanceof Error
                        ? health.reason.message
                        : String(health.reason),
                  },
            container:
              container.status === "fulfilled"
                ? container.value
                : {
                    error:
                      container.reason instanceof Error
                        ? container.reason.message
                        : String(container.reason),
                  },
          };
        }),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  server.registerTool(
    "metamcp_ops_get_container_logs",
    {
      description:
        "Read recent logs from the fixed MetaMCP application container on one managed host. Maximum 500 lines.",
      inputSchema: {
        host: HOST_SCHEMA,
        lines: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Number of log lines, 1-500; defaults to 100."),
      },
    },
    async ({ host, lines }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await getContainerLogs(host, lines), null, 2),
        },
      ],
    }),
  );

  server.registerTool(
    "metamcp_ops_container_action",
    {
      description: `Start, stop, or restart the fixed MetaMCP application container. Requires confirm="${CONFIRMATION_PHRASE}" because the action can interrupt service.`,
      inputSchema: {
        host: HOST_SCHEMA,
        action: ACTION_SCHEMA,
        confirm: z.string().describe(`Must equal ${CONFIRMATION_PHRASE}.`),
      },
    },
    async ({ host, action, confirm }) => {
      if (confirm !== CONFIRMATION_PHRASE) {
        throw new Error(
          `Container action not performed. Set confirm to ${CONFIRMATION_PHRASE}.`,
        );
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await performContainerAction(host, action),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "metamcp_ops_reload_compose_service",
    {
      description: `Recreate only the MetaMCP app service using its current Docker Compose configuration. Does not pull images, touch Postgres, or modify volumes. Requires confirm="${CONFIRMATION_PHRASE}".`,
      inputSchema: {
        host: HOST_SCHEMA,
        confirm: z.string().describe(`Must equal ${CONFIRMATION_PHRASE}.`),
      },
    },
    async ({ host, confirm }) => {
      if (confirm !== CONFIRMATION_PHRASE) {
        throw new Error(
          `Compose reload not performed. Set confirm to ${CONFIRMATION_PHRASE}.`,
        );
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(await reloadComposeService(host), null, 2),
          },
        ],
      };
    },
  );

  return server;
}

function getConfiguredApiKey() {
  const apiKey = process.env.METAMCP_OPS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "METAMCP_OPS_API_KEY must be configured before the MetaMCP operations server starts.",
    );
  }
  return apiKey;
}

function getTrustedClientIps() {
  const configuredIps = process.env.METAMCP_OPS_TRUSTED_IPS ?? "";
  return new Set(
    configuredIps
      .split(",")
      .map((ip) => ip.trim())
      .filter((ip) => isIP(ip) !== 0),
  );
}

function normalizeRemoteAddress(address: string | undefined) {
  if (!address) {
    return undefined;
  }
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function isAuthorized(
  req: express.Request,
  expectedApiKey: string,
  trustedClientIps: Set<string>,
) {
  const remoteAddress = normalizeRemoteAddress(req.socket.remoteAddress);
  if (remoteAddress && trustedClientIps.has(remoteAddress)) {
    return true;
  }

  const bearerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : undefined;
  const providedApiKey = req.headers["x-api-key"];
  const candidate =
    bearerToken ??
    (Array.isArray(providedApiKey) ? providedApiKey[0] : providedApiKey);
  if (!candidate) {
    return false;
  }
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expectedApiKey);
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}

export function createMetaMcpOpsRouter() {
  const router = express.Router();
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const servers = new Map<string, McpServer>();
  const apiKey = getConfiguredApiKey();
  const trustedClientIps = getTrustedClientIps();

  router.get("/health", (_req, res) =>
    res.json({ status: "ok", service: "metamcp-ops" }),
  );

  router.use((req, res, next) => {
    if (!isAuthorized(req, apiKey, trustedClientIps)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  router.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"];
      let transport =
        typeof sessionId === "string" ? transports.get(sessionId) : undefined;

      if (!transport) {
        if (sessionId) {
          res.status(404).json({ error: "MCP session not found" });
          return;
        }
        if (transports.size >= MAX_SESSIONS) {
          res
            .status(503)
            .json({ error: "MetaMCP operations session limit reached" });
          return;
        }

        const server = createMetaMcpOpsServer();
        const sessionTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports.set(newSessionId, sessionTransport);
            servers.set(newSessionId, server);
          },
          onsessionclosed: (closedSessionId) => {
            transports.delete(closedSessionId);
            servers.delete(closedSessionId);
          },
        });
        transport = sessionTransport;
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          error: "MetaMCP operations request failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  router.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    const transport =
      typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).json({ error: "MCP session not found" });
      return;
    }
    await transport.handleRequest(req, res);
  });

  router.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    const transport =
      typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).json({ error: "MCP session not found" });
      return;
    }
    await transport.handleRequest(req, res);
  });

  return router;
}
