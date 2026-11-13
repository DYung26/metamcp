type NamedTool = { name: string };

function limitToolsFairly<T extends NamedTool>(tools: T[], limit: number): T[] {
  if (tools.length <= limit) return tools;

  const groups = new Map<string, T[]>();
  for (const tool of tools) {
    const separator = tool.name.indexOf("__");
    const key = separator > 0 ? tool.name.slice(0, separator) : "_meta";
    groups.set(key, [...(groups.get(key) || []), tool]);
  }

  const queues = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, items]) => ({
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
      index: 0,
    }));
  const selected: T[] = [];

  while (selected.length < limit) {
    let added = false;
    for (const queue of queues) {
      const tool = queue.items[queue.index];
      if (!tool) continue;
      selected.push(tool);
      queue.index += 1;
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
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
