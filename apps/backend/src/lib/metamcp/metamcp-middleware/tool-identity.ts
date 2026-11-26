import { eq } from "drizzle-orm";

import { db } from "@/db";
import { mcpServersTable } from "@/db/schema";

import { parseToolName } from "../tool-name-parser";

export async function resolveToolIdentity(toolName: string): Promise<{
  mcpServerUuid?: string;
  mcpServerName?: string;
}> {
  const parsed = parseToolName(toolName);
  if (!parsed) {
    return {};
  }

  const [server] = await db
    .select({
      uuid: mcpServersTable.uuid,
      name: mcpServersTable.name,
    })
    .from(mcpServersTable)
    .where(eq(mcpServersTable.name, parsed.serverName));

  return {
    mcpServerUuid: server?.uuid,
    mcpServerName: server?.name ?? parsed.serverName,
  };
}

export function createToolIdentityResolver(
  toolServerUuidByName: Readonly<Record<string, string>>,
  serverNameByUuid: ReadonlyMap<string, string>,
  fallback: typeof resolveToolIdentity = resolveToolIdentity,
) {
  return async (toolName: string) => {
    const serverUuid = toolServerUuidByName[toolName];
    const serverName = serverUuid
      ? serverNameByUuid.get(serverUuid)
      : undefined;
    if (!serverUuid || !serverName) return fallback(toolName);

    return {
      mcpServerUuid: serverUuid,
      mcpServerName: serverName,
    };
  };
}
