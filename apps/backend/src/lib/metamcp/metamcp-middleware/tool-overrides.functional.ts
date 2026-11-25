import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { and, eq, isNotNull } from "drizzle-orm";

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
 * Configuration for the tool overrides middleware
 */
export interface ToolOverridesConfig {
  cacheEnabled?: boolean;
  cacheTTL?: number; // milliseconds
}

function mergeAnnotations(
  original: Tool["annotations"],
  namespaceOverrides?: Record<string, unknown> | null,
): Tool["annotations"] | undefined {
  if (!namespaceOverrides || Object.keys(namespaceOverrides).length === 0) {
    return original;
  }

  const baseAnnotations = (original ? { ...original } : {}) as Record<
    string,
    unknown
  >;

  for (const [key, value] of Object.entries(namespaceOverrides)) {
    baseAnnotations[key] = value;
  }

  return baseAnnotations as Tool["annotations"];
}

/**
 * Tool overrides cache for performance
 */
class ToolOverridesCache {
  private reverseNameCache = new Map<string, string>();

  private getReverseKey(namespaceUuid: string, exposedToolName: string): string {
    return namespaceUuid + ":" + exposedToolName;
  }

  getOriginalName(namespaceUuid: string, exposedToolName: string): string | null {
    return (
      this.reverseNameCache.get(
        this.getReverseKey(namespaceUuid, exposedToolName),
      ) || null
    );
  }

  setOriginalName(
    namespaceUuid: string,
    exposedToolName: string,
    originalName: string,
  ): void {
    this.reverseNameCache.set(
      this.getReverseKey(namespaceUuid, exposedToolName),
      originalName,
    );
  }

  clear(namespaceUuid?: string): void {
    if (namespaceUuid) {
      for (const key of this.reverseNameCache.keys()) {
        if (key.startsWith(namespaceUuid + ":"))
          this.reverseNameCache.delete(key);
      }
    } else {
      this.reverseNameCache.clear();
    }
  }
}

// Global cache instance
const toolOverridesCache = new ToolOverridesCache();

// parseToolName is now imported from shared utility

/**
 * Apply overrides to tools
 */
async function applyToolOverrides(
  tools: Tool[],
  namespaceUuid: string,
  useCache: boolean = true,
): Promise<Tool[]> {
  if (!tools || tools.length === 0) return tools;
  let mappings: Array<{
    toolName: string;
    serverName: string;
    overrideName: string | null;
    overrideTitle: string | null;
    overrideDescription: string | null;
    overrideAnnotations: Record<string, unknown> | null;
  }>;
  try {
    mappings = await db
      .select({
        toolName: toolsTable.name,
        serverName: mcpServersTable.name,
        overrideName: namespaceToolMappingsTable.override_name,
        overrideTitle: namespaceToolMappingsTable.override_title,
        overrideDescription: namespaceToolMappingsTable.override_description,
        overrideAnnotations: namespaceToolMappingsTable.override_annotations,
      })
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
          isNotNull(namespaceToolMappingsTable.override_name),
        ),
      );
  } catch (error) {
    logger.error(
      "Error fetching tool overrides for namespace " + namespaceUuid + ":",
      error,
    );
    return tools;
  }
  if (mappings.length === 0) return tools;
  const overridesByName = new Map<string, (typeof mappings)[number]>();
  for (const mapping of mappings) {
    overridesByName.set(`${mapping.serverName}__${mapping.toolName}`, mapping);
  }
  return tools.map((tool) => {
    const mapping = overridesByName.get(tool.name);
    if (!mapping) return tool;
    const parsed = parseToolName(tool.name);
    if (!parsed) return tool;
    const overriddenName =
      mapping.overrideName && mapping.overrideName.trim() !== ""
        ? parsed.serverName + "__" + mapping.overrideName
        : tool.name;
    const overriddenDescription =
      mapping.overrideDescription !== null
        ? mapping.overrideDescription
        : tool.description;
    let overriddenTitle: string | undefined = tool.title;
    if (typeof mapping.overrideTitle !== "undefined") {
      overriddenTitle =
        mapping.overrideTitle === null ? undefined : mapping.overrideTitle;
    }
    let overriddenAnnotations = tool.annotations;
    if (overriddenAnnotations) {
      if (Object.keys(overriddenAnnotations).length === 0) {
        overriddenAnnotations = undefined;
      } else if ("title" in overriddenAnnotations) {
        const { title: _removed, ...rest } = overriddenAnnotations;
        overriddenAnnotations = Object.keys(rest).length > 0 ? rest : undefined;
      }
    }
    overriddenAnnotations = mergeAnnotations(
      overriddenAnnotations,
      mapping.overrideAnnotations,
    );
    if (mapping.overrideName && useCache) {
      toolOverridesCache.setOriginalName(
        namespaceUuid,
        overriddenName,
        tool.name,
      );
    }
    return {
      ...tool,
      name: overriddenName,
      title: overriddenTitle,
      description: overriddenDescription,
      annotations: overriddenAnnotations,
    };
  });
}

/**
 * Map override name back to original name for tool calls
 */
export async function mapOverrideNameToOriginal(
  toolName: string,
  namespaceUuid: string,
  useCache: boolean = true,
): Promise<string> {
  // Parse the tool name to extract server and tool parts
  const parsed = parseToolName(toolName);
  if (!parsed) {
    // If tool name doesn't follow expected format, return as-is
    return toolName;
  }

  // Check the fully qualified exposed name to avoid cross-server collisions.
  if (useCache) {
    const originalName = toolOverridesCache.getOriginalName(
      namespaceUuid,
      toolName,
    );
    if (originalName) {
      return originalName;
    }
  }

  // If not found in cache or cache disabled, query database
  try {
    const [toolMapping] = await db
      .select({
        originalName: toolsTable.name,
        serverName: mcpServersTable.name,
      })
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
          eq(namespaceToolMappingsTable.override_name, parsed.originalToolName),
          eq(mcpServersTable.name, parsed.serverName),
        ),
      );

    if (toolMapping) {
      const originalFullName = `${toolMapping.serverName}__${toolMapping.originalName}`;

      // Cache the reverse mapping by its fully qualified exposed name
      if (useCache) {
        toolOverridesCache.setOriginalName(
          namespaceUuid,
          toolName,
          originalFullName,
        );
      }

      return originalFullName;
    }
  } catch (error) {
    logger.error(
      `Error mapping override name ${toolName} to original in namespace ${namespaceUuid}:`,
      error,
    );
  }

  // If no mapping found, return the original name
  return toolName;
}

/**
 * Resolve multiple exposed tool names with one namespace-scoped database query.
 * Names without an override mapping are returned unchanged.
 */
export async function mapOverrideNamesToOriginal(
  toolNames: string[],
  namespaceUuid: string,
): Promise<Map<string, string>> {
  const originalNames = new Map<string, string>();
  const parsedTools: Array<{
    fullName: string;
    serverName: string;
    originalToolName: string;
  }> = [];

  for (const fullName of toolNames) {
    const parsed = parseToolName(fullName);
    if (!parsed) {
      originalNames.set(fullName, fullName);
      continue;
    }
    const cachedOriginalName = toolOverridesCache.getOriginalName(
      namespaceUuid,
      fullName,
    );
    if (cachedOriginalName) {
      originalNames.set(fullName, cachedOriginalName);
      continue;
    }
    parsedTools.push({ fullName, ...parsed });
  }

  if (parsedTools.length === 0) return originalNames;

  try {
    const mappings = await db
      .select({
        originalName: toolsTable.name,
        serverName: mcpServersTable.name,
        overrideName: namespaceToolMappingsTable.override_name,
      })
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
          isNotNull(namespaceToolMappingsTable.override_name),
        ),
      );

    const originalByOverrideName = new Map<string, string>();
    for (const mapping of mappings) {
      if (!mapping.overrideName) continue;
      const overrideFullName = `${mapping.serverName}__${mapping.overrideName}`;
      if (!originalByOverrideName.has(overrideFullName)) {
        originalByOverrideName.set(
          overrideFullName,
          `${mapping.serverName}__${mapping.originalName}`,
        );
      }
    }

    for (const parsed of parsedTools) {
      const originalName =
        originalByOverrideName.get(parsed.fullName) ?? parsed.fullName;
      originalNames.set(parsed.fullName, originalName);
      if (originalName !== parsed.fullName) {
        toolOverridesCache.setOriginalName(
          namespaceUuid,
          parsed.fullName,
          originalName,
        );
      }
    }
  } catch (error) {
    logger.error(
      `Error mapping tool override names for namespace ${namespaceUuid}:`,
      error,
    );
    for (const parsed of parsedTools) {
      originalNames.set(parsed.fullName, parsed.fullName);
    }
  }

  return originalNames;
}

/**
 * Creates a List Tools middleware that applies tool name/description overrides
 */
export function createToolOverridesListToolsMiddleware(
  config: ToolOverridesConfig = {},
): ListToolsMiddleware {
  const useCache = config.cacheEnabled ?? true;

  return (handler) => {
    return async (request, context) => {
      // Call the original handler to get the tools
      const response = await handler(request, context);

      // Apply overrides to the tools
      if (response.tools) {
        const overriddenTools = await applyToolOverrides(
          response.tools,
          context.namespaceUuid,
          useCache,
        );

        return {
          ...response,
          tools: overriddenTools,
        };
      }

      return response;
    };
  };
}

/**
 * Creates a Call Tool middleware that maps override names back to original names
 */
export function createToolOverridesCallToolMiddleware(
  config: ToolOverridesConfig = {},
): CallToolMiddleware {
  const useCache = config.cacheEnabled ?? true;

  return (handler) => {
    return async (request, context) => {
      // Map override name back to original name if needed
      const originalToolName = await mapOverrideNameToOriginal(
        request.params.name,
        context.namespaceUuid,
        useCache,
      );

      // Create a new request with the original tool name
      const modifiedRequest = {
        ...request,
        params: {
          ...request.params,
          name: originalToolName,
        },
      };

      // Call the original handler with the modified request
      return handler(modifiedRequest, context);
    };
  };
}

/**
 * Utility function to clear override cache
 */
export function clearOverrideCache(namespaceUuid?: string): void {
  toolOverridesCache.clear(namespaceUuid);
}
