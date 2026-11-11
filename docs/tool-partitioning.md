# MCP tool-list partitioning

Some MCP clients enforce a hard maximum of 1,000 tools per connector. Configure the partition count on a namespace (Namespaces → Edit → Tool-list partitions). The value is stored with the namespace and applies to every Streamable HTTP endpoint backed by it. Use `1` for a single connector; use `2`–`100` to expose stable, disjoint slices.

MetaMCP owns the partition count. Connector URLs only specify the zero-based partition index; `toolPartitions` is optional for backwards compatibility and, if supplied, must match the server configuration. For a namespace configured for three partitions, the URLs are:

```text
https://YOUR_METAMCP_HOST/metamcp/YOUR_ENDPOINT/mcp?toolPartition=0
https://YOUR_METAMCP_HOST/metamcp/YOUR_ENDPOINT/mcp?toolPartition=1
https://YOUR_METAMCP_HOST/metamcp/YOUR_ENDPOINT/mcp?toolPartition=2
```

Tool assignment uses a stable hash of the exposed name. Each tool belongs to exactly one partition across sessions and refreshes. Calls are checked against the session partition, including MetaMCP admin tools. A partition exceeding the configured 1,000-tool cap fails explicitly instead of silently dropping tools.

Existing URLs without `toolPartition` retain their previous unpartitioned behavior and 1,000-tool cap. Existing clients that send both `toolPartition` and `toolPartitions` continue working when the supplied total matches the namespace configuration. Changing the configured count changes assignments and requires reconnecting affected clients.
