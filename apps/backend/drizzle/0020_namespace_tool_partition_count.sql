ALTER TABLE "namespaces" ADD COLUMN "tool_partition_count" integer DEFAULT 1 NOT NULL;

ALTER TABLE "namespaces"
ADD CONSTRAINT "namespaces_tool_partition_count_check"
CHECK ("tool_partition_count" BETWEEN 1 AND 100);

-- Keep existing oversized namespaces working without requiring a manual reconfiguration.
UPDATE "namespaces" AS namespace
SET "tool_partition_count" = LEAST(100, CEIL(tool_counts.active_tool_count::numeric / 1000)::integer)
FROM (
  SELECT namespace_uuid, COUNT(*) AS active_tool_count
  FROM "namespace_tool_mappings"
  WHERE status = 'ACTIVE'
  GROUP BY namespace_uuid
  HAVING COUNT(*) > 1000
) AS tool_counts
WHERE namespace.uuid = tool_counts.namespace_uuid;
