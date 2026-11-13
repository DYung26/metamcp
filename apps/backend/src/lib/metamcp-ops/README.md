# MetaMCP Operations MCP

This service exposes infrastructure controls for the three fixed MetaMCP installations: `vps`, `arch`, and `omarchy`.

Run it as a host-level process on the VPS. It uses the VPS Docker CLI for the VPS container and SSH for the Arch and Omarchy containers. The SSH identity must be able to run Docker commands on those hosts without an interactive prompt. SSH host keys are checked against `~/.config/metamcp-ops/known_hosts`.

## Access

The service has one MCP endpoint and two ways to reach it:

- **From the VPS MetaMCP instance:** register `http://localhost:12010/metamcp-ops/mcp` in the `unified` namespace. The MetaMCP backend has `TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL=true`, so it rewrites `localhost` to `host.docker.internal`. Docker Compose maps that hostname to the VPS host gateway. Bind the service to that gateway IP; on the VPS this is the `docker0` address `172.17.0.1`. The trusted MetaMCP app container IP is allowed without a bearer token.
- **From a client connecting directly:** use `https://vps-mcp.dyung.me/metamcp-ops/mcp` with `Authorization: Bearer <METAMCP_OPS_API_KEY>`.

These are two routes to the same service, not two MCP servers. Only the internal URL needs to be registered in the VPS `unified` namespace. Agents connecting to the `unified` endpoint do not use the external URL.

The API key is stored on the VPS in `/home/dyung/.config/metamcp-ops/env` as `METAMCP_OPS_API_KEY`. The file is restricted to the service user. The key is required for direct/external access; requests from the configured trusted container IP do not need it.

## MetaMCP administration

The MetaMCP administration tools in this repository are a custom extension in the `DYung26/metamcp` fork. They are not part of the stock upstream MetaMCP image by default.

When a public MCP endpoint has `enable_metamcp_admin_tools=true` and API-key or OAuth authentication enabled, the Streamable HTTP and SSE routes resolve the authenticated user and attach that user context to the MCP session. The endpoint then exposes the management tools under the `metamcp-admin__` prefix. Tool calls operate on the MetaMCP instance serving that endpoint. The endpoint edit UI exposes the setting.

The extension covers MCP server CRUD and bulk import; namespace CRUD, server membership, tool status and overrides; endpoint CRUD; API-key management; tool lookup and sync; OAuth sessions; configuration; and logs.

The registry currently contains 52 management tools. They are placed before namespace tools in `tools/list` results, and the configured exposure limit reserves capacity for all of them. With the default 100-tool page size, all 52 appear on the first MCP tools/list page even when a namespace contains thousands of upstream tools. When tool partitions are used, the admin tools are included in each partition.

The `metamcp-ops` server is separate from this extension. It provides infrastructure controls across the three hosts; it does not provide MetaMCP database CRUD for Arch or Omarchy unless the same custom MetaMCP code is deployed and enabled on those instances.

## Configuration

- `METAMCP_OPS_API_KEY`: required bearer token for direct/external requests. Keep it in a service-user-readable environment file, never in source control.
- `METAMCP_OPS_PORT`: optional listener port; defaults to `12010`.
- `METAMCP_OPS_HOST`: optional bind IP; defaults to `127.0.0.1`. For the VPS MetaMCP container, bind to the current Docker host-gateway address.
- `METAMCP_OPS_TRUSTED_IPS`: optional comma-separated client IP allowlist. Requests from these exact IPs may use the MCP endpoint without a bearer token; all other clients require `METAMCP_OPS_API_KEY`.

## Tools

- `metamcp_ops_list_hosts`: list the fixed managed hosts.
- `metamcp_ops_get_host_status`: fetch public health and Docker state for one or all hosts.
- `metamcp_ops_get_container_logs`: read up to 500 recent log lines.
- `metamcp_ops_container_action`: start, stop, or restart the fixed `metamcp` container.
- `metamcp_ops_reload_compose_service`: recreate only the `app` Compose service. It does not pull images, restart Postgres, or modify volumes.

Container actions and Compose reload require the exact `CONFIRM_METAMCP_OPERATION` confirmation value. No tool accepts an arbitrary hostname, container name, path, or shell command.
