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

MetaMCP's built-in admin tools are separate from this infrastructure service. When an endpoint has `enable_metamcp_admin_tools=true` and API-key or OAuth authentication enabled, MetaMCP injects its admin tools into that endpoint's tool list under the `metamcp-admin__` prefix.

Those tools cover MCP server CRUD and bulk import; namespace CRUD, server membership, server/tool status and tool overrides; endpoint CRUD; API-key management; tool lookup and sync; OAuth sessions; configuration; and logs. They are not a separately registered upstream server. They are available on the authenticated endpoint itself and operate on the MetaMCP instance serving that endpoint.

The `metamcp-ops` server below is for infrastructure operations across the three hosts. It does not provide MetaMCP database CRUD for the Arch or Omarchy instances. Those instances need their own admin-tools support and endpoint configuration before their MetaMCP records can be managed remotely.

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
