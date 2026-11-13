import express from "express";

import { createMetaMcpOpsRouter } from "./lib/metamcp-ops/server";

const DEFAULT_PORT = 12010;
const port = Number(process.env.METAMCP_OPS_PORT ?? DEFAULT_PORT);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("METAMCP_OPS_PORT must be a valid TCP port.");
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(createMetaMcpOpsRouter());

const server = app.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `MetaMCP operations MCP listening on 127.0.0.1:${port}\n`,
  );
});

function shutdown() {
  server.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
