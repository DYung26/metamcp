import { isIP } from "node:net";

import express from "express";

import { createMetaMcpOpsRouter } from "./lib/metamcp-ops/server";

const DEFAULT_PORT = 12010;
const port = Number(process.env.METAMCP_OPS_PORT ?? DEFAULT_PORT);
const host = process.env.METAMCP_OPS_HOST ?? "127.0.0.1";

if (isIP(host) === 0) {
  throw new Error("METAMCP_OPS_HOST must be a valid IP address.");
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("METAMCP_OPS_PORT must be a valid TCP port.");
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/metamcp-ops", createMetaMcpOpsRouter());

const server = app.listen(port, host, () => {
  process.stdout.write(`MetaMCP operations MCP listening on ${host}:${port}\n`);
});

function shutdown() {
  server.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
