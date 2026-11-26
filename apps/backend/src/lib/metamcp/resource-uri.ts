function getToolUiResourceUriValues(
  metaValue: unknown,
): readonly [unknown, unknown] | undefined {
  if (!metaValue || typeof metaValue !== "object") return undefined;
  const meta = metaValue as Record<string, unknown>;
  const nestedUi = meta.ui;
  const nestedUri =
    nestedUi && typeof nestedUi === "object"
      ? (nestedUi as Record<string, unknown>).resourceUri
      : undefined;

  return [nestedUri, meta["ui/resourceUri"]];
}

function isUiResourceUri(uri: unknown): uri is string {
  return typeof uri === "string" && uri.startsWith("ui://");
}

/**
 * Return MCP App resource URIs advertised by a tool.
 * Support both the current nested key and the legacy flat key used by hosts.
 */
export function getToolUiResourceUris(metaValue: unknown): string[] {
  const values = getToolUiResourceUriValues(metaValue);
  if (!values) return [];

  const uris: string[] = [];
  for (const uri of values) {
    if (isUiResourceUri(uri) && !uris.includes(uri)) {
      uris.push(uri);
    }
  }
  return uris;
}

function hasToolUiResourceUri(
  metaValue: unknown,
  resourceUri: string,
): boolean {
  const values = getToolUiResourceUriValues(metaValue);
  return (
    values?.some((uri) => isUiResourceUri(uri) && uri === resourceUri) ?? false
  );
}

export function getToolUiResourceServerUuids(
  resourceUri: string,
  tools: readonly { serverUuid: string; meta: unknown }[],
): string[] {
  const serverUuids = new Set<string>();
  for (const { serverUuid, meta } of tools) {
    if (hasToolUiResourceUri(meta, resourceUri)) {
      serverUuids.add(serverUuid);
    }
  }
  return [...serverUuids];
}

export function addResourceServerUuid(
  resourceOwners: Record<string, Set<string>>,
  resourceUri: string,
  serverUuid: string,
): void {
  const serverUuids = (resourceOwners[resourceUri] ??= new Set());
  serverUuids.add(serverUuid);
}
