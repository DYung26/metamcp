import crypto from "crypto";

/**
 * Simple in-memory cache for tool synchronization
 * Tracks the hash of tools per MCP server to avoid unnecessary DB operations
 */
type SyncableTool = {
  name: string;
  description?: string | null;
  inputSchema?: unknown;
  annotations?: Record<string, unknown> | null;
  _meta?: Record<string, unknown> | null;
};

export class ToolsSyncCache {
  private cache: Map<string, string> = new Map();

  /** Hash all persisted client-visible tool fields, not just names. */
  hashTools(tools: Array<SyncableTool | string>): string {
    const canonical = tools
      .map((tool) =>
        typeof tool === "string"
          ? {
              name: tool,
              description: "",
              inputSchema: null,
              annotations: null,
              _meta: null,
            }
          : {
              name: tool.name,
              description: tool.description ?? "",
              inputSchema: tool.inputSchema ?? null,
              annotations: tool.annotations ?? null,
              _meta: tool._meta ?? null,
            },
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex");
  }

  /** Compare a precomputed snapshot hash without serializing the tools again. */
  hasHashChanged(mcpServerUuid: string, hash: string): boolean {
    return this.cache.get(mcpServerUuid) !== hash;
  }

  /**
   * Check if tools have changed since last sync.
   * @returns true if tools changed or no cache exists, false if unchanged
   */
  hasChanged(
    mcpServerUuid: string,
    tools: Array<SyncableTool | string>,
  ): boolean {
    return this.hasHashChanged(mcpServerUuid, this.hashTools(tools));
  }

  /** Store a precomputed hash after the corresponding persistence succeeds. */
  updateHash(mcpServerUuid: string, hash: string): void {
    this.cache.set(mcpServerUuid, hash);
  }

  update(mcpServerUuid: string, tools: Array<SyncableTool | string>): void {
    this.updateHash(mcpServerUuid, this.hashTools(tools));
  }

  /**
   * Check if sync is needed and update cache if it is
   * @returns true if sync needed, false if cache hit
   */
  shouldSync(
    mcpServerUuid: string,
    tools: Array<SyncableTool | string>,
  ): boolean {
    const hash = this.hashTools(tools);
    const needsSync = this.hasHashChanged(mcpServerUuid, hash);

    if (needsSync) {
      this.updateHash(mcpServerUuid, hash);
    }

    return needsSync;
  }

  /**
   * Clear cache for specific server or entire cache
   */
  clear(mcpServerUuid?: string): void {
    if (mcpServerUuid) {
      this.cache.delete(mcpServerUuid);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    servers: string[];
  } {
    return {
      size: this.cache.size,
      servers: Array.from(this.cache.keys()),
    };
  }
}

// Singleton instance
export const toolsSyncCache = new ToolsSyncCache();
