import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";

import logger from "@/utils/logger";

import { db } from "../../../db/index";
import {
  mcpServersTable,
  namespaceToolMappingsTable,
  toolsTable,
} from "../../../db/schema";
import { parseToolName } from "../tool-name-parser";
import {
  CallToolMiddleware,
  ListToolsMiddleware,
} from "./functional-middleware";

/**
 * Configuration for the filter middleware
 */
export interface FilterToolsConfig {
  cacheEnabled?: boolean;
  cacheTTL?: number; // milliseconds
  customErrorMessage?: (toolName: string, reason: string) => string;
}

/**
 * Tool status cache for performance
 */
const DEFAULT_FILTER_CACHE_TTL_MS = 1000;
const MAX_CACHED_TOOL_STATUSES = 10_000;
const MAX_CACHED_SERVER_UUIDS = 256;
const MAX_CACHED_NAMESPACES = 256;

class ToolStatusCache {
  private cache = new Map<
    string,
    { status: "ACTIVE" | "INACTIVE" | "MISSING"; expiresAt: number }
  >();
  private ttl: number;

  constructor(ttl: number = DEFAULT_FILTER_CACHE_TTL_MS) {
    this.ttl = ttl;
  }

  private getCacheKey(
    namespaceUuid: string,
    toolName: string,
    serverUuid: string,
  ): string {
    return `${namespaceUuid}:${serverUuid}:${toolName}`;
  }

  get(
    namespaceUuid: string,
    toolName: string,
    serverUuid: string,
  ): "ACTIVE" | "INACTIVE" | "MISSING" | null {
    const key = this.getCacheKey(namespaceUuid, toolName, serverUuid);
    const cached = this.cache.get(key);

    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return cached.status;
  }

  set(
    namespaceUuid: string,
    toolName: string,
    serverUuid: string,
    status: "ACTIVE" | "INACTIVE" | "MISSING",
    ttl: number = this.ttl,
  ): void {
    const key = this.getCacheKey(namespaceUuid, toolName, serverUuid);
    if (!this.cache.has(key) && this.cache.size >= MAX_CACHED_TOOL_STATUSES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }

    this.cache.set(key, { status, expiresAt: Date.now() + ttl });
  }

  clear(namespaceUuid?: string): void {
    if (namespaceUuid) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${namespaceUuid}:`)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }
}

class ServerUuidCache {
  private cache = new Map<string, { uuid: string | null; expiresAt: number }>();

  private getCacheKey(namespaceUuid: string, serverName: string): string {
    return `${namespaceUuid}:${serverName}`;
  }

  get(namespaceUuid: string, serverName: string): string | null | undefined {
    const key = this.getCacheKey(namespaceUuid, serverName);
    const cached = this.cache.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return cached.uuid;
  }

  set(
    namespaceUuid: string,
    serverName: string,
    uuid: string | null,
    ttl: number,
  ): void {
    const key = this.getCacheKey(namespaceUuid, serverName);
    if (!this.cache.has(key) && this.cache.size >= MAX_CACHED_SERVER_UUIDS) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { uuid, expiresAt: Date.now() + ttl });
  }

  clear(namespaceUuid?: string): void {
    if (!namespaceUuid) {
      this.cache.clear();
      return;
    }

    for (const key of this.cache.keys()) {
      if (key.startsWith(`${namespaceUuid}:`)) this.cache.delete(key);
    }
  }
}

const toolStatusCache = new ToolStatusCache();
const serverUuidCache = new ServerUuidCache();

class InactiveToolsCache {
  private cache = new Map<string, { names: Set<string>; expiresAt: number }>();

  get(namespaceUuid: string): Set<string> | null {
    const cached = this.cache.get(namespaceUuid);
    if (!cached) return null;

    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(namespaceUuid);
      return null;
    }

    return cached.names;
  }

  set(namespaceUuid: string, names: Set<string>, ttl: number): void {
    if (
      !this.cache.has(namespaceUuid) &&
      this.cache.size >= MAX_CACHED_NAMESPACES
    ) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }

    this.cache.set(namespaceUuid, {
      names,
      expiresAt: Date.now() + ttl,
    });
  }

  clear(namespaceUuid?: string): void {
    if (namespaceUuid) {
      this.cache.delete(namespaceUuid);
    } else {
      this.cache.clear();
    }
  }
}

const inactiveToolsCache = new InactiveToolsCache();

/**
 * Get tool status from database with caching
 */
async function getToolStatus(
  namespaceUuid: string,
  toolName: string,
  serverUuid: string,
  useCache: boolean = true,
  cacheTTL: number = DEFAULT_FILTER_CACHE_TTL_MS,
): Promise<"ACTIVE" | "INACTIVE" | null> {
  if (useCache) {
    const cached = toolStatusCache.get(namespaceUuid, toolName, serverUuid);
    if (cached !== null) {
      return cached === "MISSING" ? null : cached;
    }
  }

  try {
    // Query database for tool status
    const [toolMapping] = await db
      .select({
        status: namespaceToolMappingsTable.status,
      })
      .from(namespaceToolMappingsTable)
      .innerJoin(
        toolsTable,
        eq(toolsTable.uuid, namespaceToolMappingsTable.tool_uuid),
      )
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          eq(toolsTable.name, toolName),
          eq(toolsTable.mcp_server_uuid, serverUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, serverUuid),
        ),
      );

    const status = toolMapping?.status || null;

    if (useCache) {
      toolStatusCache.set(
        namespaceUuid,
        toolName,
        serverUuid,
        status ?? "MISSING",
        cacheTTL,
      );
    }

    return status;
  } catch (error) {
    logger.error(
      `Error fetching tool status for ${toolName} in namespace ${namespaceUuid}:`,
      error,
    );
    return null;
  }
}

// parseToolName is now imported from shared utility

/**
 * Get server UUID by name
 */
async function getServerUuidByName(
  namespaceUuid: string,
  serverName: string,
  useCache: boolean = true,
  cacheTTL: number = DEFAULT_FILTER_CACHE_TTL_MS,
): Promise<string | null> {
  if (useCache) {
    const cached = serverUuidCache.get(namespaceUuid, serverName);
    if (cached !== undefined) return cached;
  }

  try {
    const [server] = await db
      .select({ uuid: mcpServersTable.uuid })
      .from(mcpServersTable)
      .where(eq(mcpServersTable.name, serverName));

    const serverUuid = server?.uuid ?? null;
    if (useCache) {
      serverUuidCache.set(namespaceUuid, serverName, serverUuid, cacheTTL);
    }
    return serverUuid;
  } catch (error) {
    logger.error(`Error fetching server UUID for ${serverName}:`, error);
    return null;
  }
}

/**
 * Filter tools based on their status in the namespace
 */
async function filterActiveTools(
  tools: Tool[],
  namespaceUuid: string,
  useCache: boolean = true,
  cacheTTL: number = DEFAULT_FILTER_CACHE_TTL_MS,
): Promise<Tool[]> {
  if (!tools || tools.length === 0) return tools;

  let inactiveNames = useCache ? inactiveToolsCache.get(namespaceUuid) : null;

  if (!inactiveNames) {
    try {
      const inactiveMappings = await db
        .select({ toolName: toolsTable.name, serverName: mcpServersTable.name })
        .from(namespaceToolMappingsTable)
        .innerJoin(
          toolsTable,
          eq(toolsTable.uuid, namespaceToolMappingsTable.tool_uuid),
        )
        .innerJoin(
          mcpServersTable,
          eq(mcpServersTable.uuid, namespaceToolMappingsTable.mcp_server_uuid),
        )
        .where(
          and(
            eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
            eq(namespaceToolMappingsTable.status, "INACTIVE"),
          ),
        );

      inactiveNames = new Set<string>();
      for (const { serverName, toolName } of inactiveMappings) {
        inactiveNames.add(`${serverName}__${toolName}`);
      }

      if (useCache) {
        inactiveToolsCache.set(namespaceUuid, inactiveNames, cacheTTL);
      }
    } catch (error) {
      logger.error(
        `Error fetching inactive tool mappings for namespace ${namespaceUuid}:`,
        error,
      );
      return tools;
    }
  }

  if (inactiveNames.size === 0) return tools;
  return tools.filter((tool) => !inactiveNames.has(tool.name));
}

/**
 * Check if a tool is allowed to be called
 */
async function isToolAllowed(
  toolName: string,
  namespaceUuid: string,
  serverUuid: string,
  useCache: boolean = true,
  cacheTTL: number = DEFAULT_FILTER_CACHE_TTL_MS,
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const parsed = parseToolName(toolName);
    if (!parsed) {
      // If tool name doesn't follow expected format, allow it
      return { allowed: true };
    }

    const status = await getToolStatus(
      namespaceUuid,
      parsed.originalToolName,
      serverUuid,
      useCache,
      cacheTTL,
    );

    // If no mapping exists or tool is active, allow it
    if (status === null || status === "ACTIVE") {
      return { allowed: true };
    }

    // Tool is inactive
    return {
      allowed: false,
      reason: "Tool has been marked as inactive in this namespace",
    };
  } catch (error) {
    logger.error(
      `Error checking if tool ${toolName} is allowed in namespace ${namespaceUuid}:`,
      error,
    );
    // On error, allow the tool (fail-safe behavior)
    return { allowed: true };
  }
}

/**
 * Creates a List Tools middleware that filters out inactive tools
 */
export function createFilterListToolsMiddleware(
  config: FilterToolsConfig = {},
): ListToolsMiddleware {
  const useCache = config.cacheEnabled ?? true;
  const cacheTTL = config.cacheTTL ?? DEFAULT_FILTER_CACHE_TTL_MS;

  return (handler) => {
    return async (request, context) => {
      // Call the original handler to get the tools
      const response = await handler(request, context);

      // Filter the tools based on namespace tool mappings
      if (response.tools) {
        const filteredTools = await filterActiveTools(
          response.tools,
          context.namespaceUuid,
          useCache,
          cacheTTL,
        );

        return {
          ...response,
          tools: filteredTools,
        };
      }

      return response;
    };
  };
}

/**
 * Creates a Call Tool middleware that blocks calls to inactive tools
 */
export function createFilterCallToolMiddleware(
  config: FilterToolsConfig = {},
): CallToolMiddleware {
  const useCache = config.cacheEnabled ?? true;
  const cacheTTL = config.cacheTTL ?? DEFAULT_FILTER_CACHE_TTL_MS;
  const customErrorMessage =
    config.customErrorMessage ??
    ((toolName: string, reason: string) =>
      `Tool "${toolName}" is currently inactive and disallowed in this namespace: ${reason}`);

  return (handler) => {
    return async (request, context) => {
      // Extract tool name and server info from the request
      const toolName = request.params.name;

      // We need to get serverUuid somehow - this would need to be passed through context
      // For now, let's extract it from the tool name format
      const parsed = parseToolName(toolName);
      if (parsed) {
        const serverUuid = await getServerUuidByName(
          context.namespaceUuid,
          parsed.serverName,
          useCache,
          cacheTTL,
        );
        if (serverUuid) {
          const { allowed, reason } = await isToolAllowed(
            toolName,
            context.namespaceUuid,
            serverUuid,
            useCache,
            cacheTTL,
          );

          if (!allowed) {
            return {
              content: [
                {
                  type: "text",
                  text: customErrorMessage(
                    toolName,
                    reason || "Unknown reason",
                  ),
                },
              ],
              isError: true,
            };
          }
        }
      }

      // Tool is allowed, call the original handler
      return handler(request, context);
    };
  };
}

/**
 * Utility function to clear cache
 */
export function clearFilterCache(namespaceUuid?: string): void {
  toolStatusCache.clear(namespaceUuid);
  inactiveToolsCache.clear(namespaceUuid);
  serverUuidCache.clear(namespaceUuid);
}
