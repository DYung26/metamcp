import type {
  DatabaseMcpServer,
  DatabaseOAuthSession,
  ServerParameters,
} from "@repo/zod-types";

import logger from "@/utils/logger";

import { oauthSessionsRepository } from "../../db/repositories/oauth-sessions.repo";

/**
 * Environment variables to inherit by default, if an environment is not explicitly given.
 */
export const DEFAULT_INHERITED_ENV_VARS =
  process.platform === "win32"
    ? [
        "APPDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "LOCALAPPDATA",
        "PATH",
        "PROCESSOR_ARCHITECTURE",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TEMP",
        "USERNAME",
        "USERPROFILE",
      ]
    : /* list inspired by the default env inheritance of sudo */
      [
        "HOME",
        "LOGNAME",
        "PATH",
        "SHELL",
        "TERM",
        "USER",
        // SSL/Certificate variables for corporate proxies and custom CA certificates
        "NODE_EXTRA_CA_CERTS",
        "NODE_TLS_REJECT_UNAUTHORIZED",
        "SSL_CERT_FILE",
        "CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "REQUESTS_CERT_FILE",
        "CURL_CA_BUNDLE",
        "PIP_CERT",
        "UV_CERT",
        "PYTHONHTTPSVERIFY",
        // Proxy variables
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
      ];

/**
 * Returns a default environment object including only environment variables deemed safe to inherit.
 */
export function getDefaultEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = process.env[key];
    if (value === undefined) {
      continue;
    }

    if (value.startsWith("()")) {
      // Skip functions, which are a security risk.
      continue;
    }

    env[key] = value;
  }

  return env;
}

export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Converts a database MCP server record to ServerParameters format
 * @param server Database MCP server record
 * @param oauthSessionOverride Preloaded session. `undefined` triggers a lookup;
 *   `null` means no session exists.
 * @returns ServerParameters object or null if conversion fails
 */
export async function convertDbServerToParams(
  server: DatabaseMcpServer,
  oauthSessionOverride?: DatabaseOAuthSession | null,
): Promise<ServerParameters | null> {
  try {
    // Fetch OAuth tokens unless the caller already loaded them in a batch.
    const oauthSession =
      oauthSessionOverride === undefined
        ? await oauthSessionsRepository.findByMcpServerUuid(server.uuid)
        : oauthSessionOverride;
    let oauthTokens = null;

    if (oauthSession && oauthSession.tokens) {
      oauthTokens = {
        access_token: oauthSession.tokens.access_token,
        token_type: oauthSession.tokens.token_type,
        expires_in: oauthSession.tokens.expires_in,
        scope: oauthSession.tokens.scope,
        refresh_token: oauthSession.tokens.refresh_token,
      };
    }

    const params: ServerParameters = {
      uuid: server.uuid,
      name: server.name,
      description: server.description || "",
      type: server.type || "STDIO",
      command: server.command,
      args: server.args || [],
      env: server.env || {},
      url: server.url,
      created_at: server.created_at?.toISOString() || new Date().toISOString(),
      status: "active", // Default status for non-namespace servers
      stderr: "inherit" as const,
      oauth_tokens: oauthTokens,
      bearerToken: server.bearerToken,
      headers: server.headers || {},
      forward_headers: server.forward_headers || {},
    };

    // Process based on server type
    if (params.type === "STDIO") {
      if ("args" in params && !params.args) {
        params.args = undefined;
      }

      params.env = {
        ...getDefaultEnvironment(),
        ...(params.env || {}),
      };
    } else if (params.type === "SSE" || params.type === "STREAMABLE_HTTP") {
      // For SSE or STREAMABLE_HTTP servers, ensure url is present
      if (!params.url) {
        logger.warn(
          `${params.type} server ${params.uuid} is missing url field, skipping`,
        );
        return null;
      }
    }

    return params;
  } catch (error) {
    logger.error(
      `Error converting server ${server.uuid} to parameters:`,
      error,
    );
    return null;
  }
}

/**
 * Convert multiple servers using one OAuth-session query instead of one query
 * per server.
 */
export async function convertDbServersToParams(
  servers: DatabaseMcpServer[],
): Promise<Record<string, ServerParameters>> {
  if (servers.length === 0) return {};

  let oauthSessions: DatabaseOAuthSession[];
  try {
    oauthSessions = await oauthSessionsRepository.findByMcpServerUuids(
      servers.map((server) => server.uuid),
    );
  } catch (error) {
    logger.error(
      "Error fetching OAuth sessions in batch; falling back to individual lookups:",
      error,
    );
    const fallbackParams: Record<string, ServerParameters> = {};
    for (const server of servers) {
      const params = await convertDbServerToParams(server);
      if (params) fallbackParams[server.uuid] = params;
    }
    return fallbackParams;
  }

  const oauthSessionByServer = new Map<string, DatabaseOAuthSession>();
  for (const session of oauthSessions) {
    oauthSessionByServer.set(session.mcp_server_uuid, session);
  }

  const convertedServers = await Promise.all(
    servers.map((server) =>
      convertDbServerToParams(
        server,
        oauthSessionByServer.get(server.uuid) ?? null,
      ),
    ),
  );
  const serverParams: Record<string, ServerParameters> = {};
  for (let index = 0; index < servers.length; index++) {
    const params = convertedServers[index];
    if (params) serverParams[servers[index].uuid] = params;
  }

  return serverParams;
}

/**
 * Resolves environment variable placeholders in an environment object.
 * Replaces values like "${VAR_NAME}" with the actual environment variable value.
 * @param envObject Environment object that may contain placeholder values
 * @returns Environment object with resolved values
 */
// Env values flow from process.env (string | undefined) through the loosely-typed
// stdio spawn chain (createStdioKey/isStdioInCooldown/ProcessManagedStdioTransport),
// so this stays intentionally permissive; tightening it cascades through that chain.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EnvRecord = Record<string, any>;

export function resolveEnvVariables(envObject: EnvRecord): EnvRecord {
  const resolved: EnvRecord = {};

  for (const [key, value] of Object.entries(envObject)) {
    if (
      typeof value === "string" &&
      value.startsWith("${") &&
      value.endsWith("}")
    ) {
      const varName = value.slice(2, -1);
      const envValue = process.env[varName];
      if (envValue) {
        resolved[key] = envValue;
        logger.info(
          `Resolved environment variable: ${key}=${value} -> ${varName}=[REDACTED]`,
        );
      } else {
        resolved[key] = value; // Keep original value if env var not found
        logger.warn(
          `Environment variable not found: ${varName}, keeping original value: ${value}`,
        );
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}
