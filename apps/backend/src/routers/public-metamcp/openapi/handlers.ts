import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolResult,
  CompatibilityCallToolResultSchema,
  ListToolsResultSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import logger from "@/utils/logger";

import { configService } from "../../../lib/config.service";
import { getMcpServers } from "../../../lib/metamcp/fetch-metamcp";
import { mcpServerPool } from "../../../lib/metamcp/mcp-server-pool";
import { createAuditCallToolMiddleware } from "../../../lib/metamcp/metamcp-middleware/audit-requests.functional";
import {
  createFilterCallToolMiddleware,
  createFilterListToolsMiddleware,
} from "../../../lib/metamcp/metamcp-middleware/filter-tools.functional";
import {
  CallToolHandler,
  compose,
  ListToolsHandler,
  MetaMCPHandlerContext,
} from "../../../lib/metamcp/metamcp-middleware/functional-middleware";
import { createToolIdentityResolver } from "@/lib/metamcp/metamcp-middleware/tool-identity";
import {
  createToolOverridesCallToolMiddleware,
  createToolOverridesListToolsMiddleware,
} from "../../../lib/metamcp/metamcp-middleware/tool-overrides.functional";
import { sanitizeName } from "../../../lib/metamcp/utils";

type ToolRoutingCache = {
  toolToServerUuid: Record<string, string>;
  serverNameByUuid: Map<string, string>;
};

// Original List Tools Handler (adapted from metamcp-proxy.ts)
export const createOriginalListToolsHandler = (
  includeInactiveServers: boolean = false,
  toolRoutingCache?: ToolRoutingCache,
): ListToolsHandler => {
  return async (request, context) => {
    if (toolRoutingCache) {
      for (const toolName of Object.keys(toolRoutingCache.toolToServerUuid)) {
        delete toolRoutingCache.toolToServerUuid[toolName];
      }
      toolRoutingCache.serverNameByUuid.clear();
    }
    const serverParams = await getMcpServers(
      context.namespaceUuid,
      includeInactiveServers,
    );
    const allTools: Tool[] = [];
    let mcpRequestOptions: RequestOptions;
    try {
      mcpRequestOptions = await configService.getMcpExecutionConfig();
    } catch (error) {
      logger.error("Error loading MCP request options", error);
      return { tools: allTools };
    }

    await Promise.allSettled(
      Object.entries(serverParams).map(async ([mcpServerUuid, params]) => {
        const session = await mcpServerPool.getSession(
          context.sessionId,
          mcpServerUuid,
          params,
          context.namespaceUuid,
        );
        if (!session) return;

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.tools) return;

        // Use name assigned by user, fallback to name from server
        const serverName =
          params.name || session.client.getServerVersion()?.name || "";
        toolRoutingCache?.serverNameByUuid.set(
          mcpServerUuid,
          params.name || sanitizeName(serverName),
        );
        try {
          // Get configurable timeout values to bypass MCP SDK default enforcement
          const result = await session.client.request(
            {
              method: "tools/list",
              params: { _meta: request.params?._meta },
            },
            ListToolsResultSchema,
            mcpRequestOptions,
          );

          const toolsWithSource =
            result.tools?.map((tool) => {
              const toolName = `${sanitizeName(serverName)}__${tool.name}`;
              if (toolRoutingCache) {
                toolRoutingCache.toolToServerUuid[toolName] = mcpServerUuid;
              }
              return {
                ...tool,
                name: toolName,
                description: tool.description,
              };
            }) || [];

          allTools.push(...toolsWithSource);
        } catch (error) {
          logger.error(`Error fetching tools from: ${serverName}`, error);
        }
      }),
    );

    return { tools: allTools };
  };
};

// Original Call Tool Handler (adapted from metamcp-proxy.ts)
export const createOriginalCallToolHandler = (
  toolRoutingCache?: ToolRoutingCache,
): CallToolHandler => {
  const toolToServerUuid = toolRoutingCache?.toolToServerUuid ?? {};
  const serverNameByUuid = toolRoutingCache?.serverNameByUuid ?? new Map();

  return async (request, context) => {
    const { name, arguments: args } = request.params;

    // Extract the original tool name by removing the server prefix
    const firstDoubleUnderscoreIndex = name.indexOf("__");
    if (firstDoubleUnderscoreIndex === -1) {
      throw new Error(`Invalid tool name format: ${name}`);
    }

    const serverPrefix = name.substring(0, firstDoubleUnderscoreIndex);
    const originalToolName = name.substring(firstDoubleUnderscoreIndex + 2);

    // Resolve the server UUID from the tools/list cache, then ask the pool for
    // the current session instead of scanning every configured server.
    const serverParams = await getMcpServers(context.namespaceUuid);
    const cachedServerUuid = toolToServerUuid[name];
    let targetSession = null;

    if (cachedServerUuid) {
      const params = serverParams[cachedServerUuid];
      if (params) {
        const session = await mcpServerPool.getSession(
          context.sessionId,
          cachedServerUuid,
          params,
          context.namespaceUuid,
        );
        if (session?.client.getServerCapabilities()?.tools) {
          const serverName =
            params.name || session.client.getServerVersion()?.name || "";
          if (sanitizeName(serverName) === serverPrefix) {
            targetSession = session;
            serverNameByUuid.set(
              cachedServerUuid,
              params.name || sanitizeName(serverName),
            );
          } else {
            delete toolToServerUuid[name];
          }
        } else {
          delete toolToServerUuid[name];
        }
      } else {
        delete toolToServerUuid[name];
      }
    }

    if (!targetSession) {
      for (const [mcpServerUuid, params] of Object.entries(serverParams)) {
        if (mcpServerUuid === cachedServerUuid) continue;
        const session = await mcpServerPool.getSession(
          context.sessionId,
          mcpServerUuid,
          params,
          context.namespaceUuid,
        );
        if (!session) continue;

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.tools) continue;

        const serverName =
          params.name || session.client.getServerVersion()?.name || "";
        if (sanitizeName(serverName) !== serverPrefix) continue;

        targetSession = session;
        toolToServerUuid[name] = mcpServerUuid;
        serverNameByUuid.set(
          mcpServerUuid,
          params.name || sanitizeName(serverName),
        );
        break;
      }
    }

    if (!targetSession) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      // Get configurable timeout values to bypass MCP SDK default enforcement
      const mcpRequestOptions = await configService.getMcpExecutionConfig();

      // Use the correct schema for tool calls with timeout options
      const result = await targetSession.client.request(
        {
          method: "tools/call",
          params: {
            name: originalToolName,
            arguments: args || {},
            _meta: {
              progressToken: request.params._meta?.progressToken,
            },
          },
        },
        CompatibilityCallToolResultSchema,
        mcpRequestOptions,
      );

      // Cast the result to CallToolResult type
      return result as CallToolResult;
    } catch (error) {
      logger.error(
        `Error calling tool "${name}" through ${
          targetSession.client.getServerVersion()?.name || "unknown"
        }:`,
        error,
      );
      throw error;
    }
  };
};

// Helper function to create middleware-enabled handlers
export const createMiddlewareEnabledHandlers = (
  sessionId: string,
  namespaceUuid: string,
  requestContext?: Pick<MetaMCPHandlerContext, "endpointName" | "auth">,
) => {
  // Create the handler context
  const handlerContext: MetaMCPHandlerContext = {
    namespaceUuid,
    sessionId,
    endpointName: requestContext?.endpointName || "unknown",
    auth: requestContext?.auth,
  };

  // Create original handlers
  const toolRoutingCache: ToolRoutingCache = {
    toolToServerUuid: {},
    serverNameByUuid: new Map(),
  };
  const originalListToolsHandler = createOriginalListToolsHandler(
    false,
    toolRoutingCache,
  );
  const originalCallToolHandler =
    createOriginalCallToolHandler(toolRoutingCache);

  // Compose middleware with handlers
  const listToolsWithMiddleware = compose(
    createToolOverridesListToolsMiddleware({ cacheEnabled: true }),
    createFilterListToolsMiddleware({ cacheEnabled: true }),
    // Add more middleware here as needed
    // createLoggingMiddleware(),
    // createRateLimitingMiddleware(),
  )(originalListToolsHandler);

  const callToolWithMiddleware = compose(
    createAuditCallToolMiddleware({
      resolveToolIdentity: createToolIdentityResolver(
        toolRoutingCache.toolToServerUuid,
        toolRoutingCache.serverNameByUuid,
      ),
    }),
    createFilterCallToolMiddleware({
      cacheEnabled: true,
      customErrorMessage: (toolName, reason) =>
        `Access denied to tool "${toolName}": ${reason}`,
    }),
    createToolOverridesCallToolMiddleware({ cacheEnabled: true }),
    // Add more middleware here as needed
    // createAuthorizationMiddleware(),
  )(originalCallToolHandler);

  return {
    handlerContext,
    listToolsWithMiddleware,
    callToolWithMiddleware,
  };
};
