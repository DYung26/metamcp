ALTER TABLE "namespaces" ADD COLUMN "tool_partition_count" integer DEFAULT 1 NOT NULL;

ALTER TABLE "namespaces"
ADD CONSTRAINT "namespaces_tool_partition_count_check"
CHECK ("tool_partition_count" BETWEEN 1 AND 100);

-- Keep existing oversized namespaces working without requiring a manual reconfiguration.
UPDATE "namespaces" AS namespace
SET "tool_partition_count" = LEAST(100, CEIL(tool_counts.active_tool_count::numeric / 1000)::integer)
FROM (
  SELECT nsm.namespace_uuid, COUNT(DISTINCT tools.uuid) AS active_tool_count
  FROM "namespace_server_mappings" AS nsm
  INNER JOIN "tools" AS tools
    ON tools.mcp_server_uuid = nsm.mcp_server_uuid
  WHERE nsm.status = 'ACTIVE'
  GROUP BY nsm.namespace_uuid
  HAVING COUNT(DISTINCT tools.uuid) > 1000
) AS tool_counts
WHERE namespace.uuid = tool_counts.namespace_uuid;
