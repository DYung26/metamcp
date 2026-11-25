import {
  NamespaceServerStatusUpdate,
  NamespaceToolOverridesUpdate,
  NamespaceToolStatusUpdate,
} from "@repo/zod-types";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../index";
import {
  namespaceServerMappingsTable,
  namespaceToolMappingsTable,
} from "../schema";

const NAMESPACE_TOOL_MAPPING_BATCH_SIZE = 1000;

export class NamespaceMappingsRepository {
  async updateServerStatus(input: NamespaceServerStatusUpdate) {
    const [updatedMapping] = await db
      .update(namespaceServerMappingsTable)
      .set({
        status: input.status,
      })
      .where(
        and(
          eq(namespaceServerMappingsTable.namespace_uuid, input.namespaceUuid),
          eq(namespaceServerMappingsTable.mcp_server_uuid, input.serverUuid),
        ),
      )
      .returning();

    return updatedMapping;
  }

  async updateToolStatus(
    input: NamespaceToolStatusUpdate,
  ): Promise<typeof namespaceToolMappingsTable.$inferSelect | undefined> {
    const [updatedMapping] = await db
      .update(namespaceToolMappingsTable)
      .set({
        status: input.status,
      })
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, input.namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, input.toolUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, input.serverUuid),
        ),
      )
      .returning();

    return updatedMapping;
  }

  async updateToolOverrides(input: NamespaceToolOverridesUpdate) {
    const [updatedMapping] = await db
      .update(namespaceToolMappingsTable)
      .set({
        override_name: input.overrideName,
        override_title: input.overrideTitle,
        override_description: input.overrideDescription,
        override_annotations: input.overrideAnnotations,
      })
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, input.namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, input.toolUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, input.serverUuid),
        ),
      )
      .returning();

    return updatedMapping;
  }

  async findServerMapping(namespaceUuid: string, serverUuid: string) {
    const [mapping] = await db
      .select()
      .from(namespaceServerMappingsTable)
      .where(
        and(
          eq(namespaceServerMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceServerMappingsTable.mcp_server_uuid, serverUuid),
        ),
      );

    return mapping;
  }

  /**
   * Find all namespace UUIDs that use a specific MCP server
   */
  async findNamespacesByServerUuid(serverUuid: string): Promise<string[]> {
    const mappings = await db
      .select({
        namespace_uuid: namespaceServerMappingsTable.namespace_uuid,
      })
      .from(namespaceServerMappingsTable)
      .where(eq(namespaceServerMappingsTable.mcp_server_uuid, serverUuid));

    return mappings.map((mapping) => mapping.namespace_uuid);
  }

  /**
   * Get all existing tool mappings for a namespace
   */
  async findToolMappingsByNamespace(namespaceUuid: string) {
    const mappings = await db
      .select()
      .from(namespaceToolMappingsTable)
      .where(eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid));

    return mappings;
  }

  async findToolMapping(
    namespaceUuid: string,
    toolUuid: string,
    serverUuid: string,
  ) {
    const [mapping] = await db
      .select()
      .from(namespaceToolMappingsTable)
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, toolUuid),
          eq(namespaceToolMappingsTable.mcp_server_uuid, serverUuid),
        ),
      );

    return mapping;
  }

  /**
   * Bulk upsert namespace tool mappings for a namespace
   * Used when refreshing tools from MetaMCP connection
   */
  async bulkUpsertNamespaceToolMappings(input: {
    namespaceUuid: string;
    toolMappings: Array<{
      toolUuid: string;
      serverUuid: string;
      status?: "ACTIVE" | "INACTIVE";
    }>;
  }) {
    if (!input.toolMappings || input.toolMappings.length === 0) {
      return [];
    }

    const mappingsToInsert = input.toolMappings.map((mapping) => ({
      namespace_uuid: input.namespaceUuid,
      tool_uuid: mapping.toolUuid,
      mcp_server_uuid: mapping.serverUuid,
      status: (mapping.status || "ACTIVE") as "ACTIVE" | "INACTIVE",
    }));

    const upsertedMappings: (typeof namespaceToolMappingsTable.$inferSelect)[] =
      [];
    for (
      let offset = 0;
      offset < mappingsToInsert.length;
      offset += NAMESPACE_TOOL_MAPPING_BATCH_SIZE
    ) {
      const batch = mappingsToInsert.slice(
        offset,
        offset + NAMESPACE_TOOL_MAPPING_BATCH_SIZE,
      );
      const upsertedBatch = await db
        .insert(namespaceToolMappingsTable)
        .values(batch)
        .onConflictDoUpdate({
          target: [
            namespaceToolMappingsTable.namespace_uuid,
            namespaceToolMappingsTable.tool_uuid,
          ],
          set: {
            status: sql`excluded.status`,
            mcp_server_uuid: sql`excluded.mcp_server_uuid`,
          },
        })
        .returning();
      upsertedMappings.push(...upsertedBatch);
    }

    return upsertedMappings;
  }
}

export const namespaceMappingsRepository = new NamespaceMappingsRepository();
