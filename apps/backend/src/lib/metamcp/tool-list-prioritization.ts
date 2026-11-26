type NamedTool = { name: string };

function limitToolsFairly<T extends NamedTool>(tools: T[], limit: number): T[] {
  if (tools.length <= limit) return tools;

  const groups = new Map<string, T[]>();
  for (const tool of tools) {
    const separator = tool.name.indexOf("__");
    const key = separator > 0 ? tool.name.slice(0, separator) : "_meta";
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(tool);
  }

  const queues = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, items]) => ({
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
      index: 0,
    }));
  const selected: T[] = [];
  let activeQueueCount = queues.length;

  while (selected.length < limit && activeQueueCount > 0) {
    let nextActiveQueueCount = 0;
    for (let queueIndex = 0; queueIndex < activeQueueCount; queueIndex++) {
      const queue = queues[queueIndex];
      selected.push(queue.items[queue.index++]);
      if (queue.index < queue.items.length) {
        queues[nextActiveQueueCount++] = queue;
      }
      if (selected.length === limit) break;
    }
    activeQueueCount = nextActiveQueueCount;
  }

  return selected;
}

export function prioritizeAdminTools<T extends NamedTool>(
  namespaceTools: T[],
  adminTools: T[],
  maxExposedTools: number,
  options: { partitioned?: boolean } = {},
): T[] {
  if (adminTools.length > maxExposedTools) {
    throw new Error(
      `MCP_TOOLS_LIST_MAX_TOOLS (${maxExposedTools}) is lower than the ${adminTools.length} required MetaMCP admin tools. Increase it to expose all admin tools.`,
    );
  }

  const namespaceLimit = maxExposedTools - adminTools.length;
  if (options.partitioned && namespaceTools.length > namespaceLimit) {
    throw new Error(
      `Tool partition contains ${namespaceTools.length + adminTools.length} tools, exceeding the ${maxExposedTools}-tool client limit. Increase toolPartitions.`,
    );
  }

  const selectedNamespaceTools = options.partitioned
    ? namespaceTools
    : limitToolsFairly(namespaceTools, namespaceLimit);

  return [...adminTools, ...selectedNamespaceTools];
}
