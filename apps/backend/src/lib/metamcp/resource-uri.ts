/**
 * Return MCP App resource URIs advertised by a tool.
 * Support both the current nested key and the legacy flat key used by hosts.
 */
export function getToolUiResourceUris(metaValue: unknown): string[] {
  if (!metaValue || typeof metaValue !== "object") return [];
  const meta = metaValue as Record<string, unknown>;

  const nestedUi = meta.ui;
  const nestedUri =
    nestedUi && typeof nestedUi === "object"
      ? (nestedUi as Record<string, unknown>).resourceUri
      : undefined;
  const flatUri = meta["ui/resourceUri"];

  return [nestedUri, flatUri].filter(
    (uri, index, all): uri is string =>
      typeof uri === "string" &&
      uri.startsWith("ui://") &&
      all.indexOf(uri) === index,
  );
}

export function getToolUiResourceServerUuids(
  resourceUri: string,
  tools: readonly { serverUuid: string; meta: unknown }[],
): string[] {
  return [
    ...new Set(
      tools
        .filter(({ meta }) => getToolUiResourceUris(meta).includes(resourceUri))
        .map(({ serverUuid }) => serverUuid),
    ),
  ];
}
