# MetaMCP Operations MCP

This service exposes a separate infrastructure-control MCP endpoint for the three fixed MetaMCP installations: `vps`, `arch`, and `omarchy`.

Run it as a host-level process on the VPS, not inside the MetaMCP application container. The process uses the VPS Docker CLI for its local container and the VPS SSH configuration for the Arch and Omarchy containers. The SSH identity must be able to run Docker commands on those two hosts without an interactive prompt. The process uses `~/.config/metamcp-ops/known_hosts` with strict host-key checking, independently of the interactive SSH configuration.

## Configuration

- `METAMCP_OPS_API_KEY`: required bearer token. Keep it in a service-user-readable environment file, never in source control.
- `METAMCP_OPS_PORT`: optional listener port; defaults to `12010`.
- `METAMCP_OPS_HOST`: optional bind IP; defaults to `127.0.0.1`.
- `METAMCP_OPS_TRUSTED_IPS`: optional comma-separated client IP allowlist. Requests from these exact IPs may use the MCP endpoint without a bearer token; all other clients still require `METAMCP_OPS_API_KEY`.

For external access, expose the service through the existing VPS Cloudflare Tunnel at `https://vps-mcp.dyung.me/metamcp-ops` and keep bearer authentication enabled. For the unified MetaMCP namespace on the same VPS, prefer the private Docker bridge address `http://host.docker.internal:12010` and trust only the MetaMCP app container IP. Configure an external MetaMCP upstream as `https://vps-mcp.dyung.me/metamcp-ops/mcp` with `Authorization: Bearer <METAMCP_OPS_API_KEY>`. For the unified namespace running inside the VPS MetaMCP container, use `http://host.docker.internal:12010/metamcp-ops/mcp` without a bearer header; the service checks the caller's exact container IP.

## Tools

- `metamcp_ops_list_hosts`: list the fixed managed hosts.
- `metamcp_ops_get_host_status`: fetch public health and Docker state for one or all hosts.
- `metamcp_ops_get_container_logs`: read up to 500 recent log lines.
- `metamcp_ops_container_action`: start, stop, or restart the fixed `metamcp` container.
- `metamcp_ops_reload_compose_service`: recreate only the `app` Compose service. It does not pull images, restart Postgres, or modify volumes.

Container actions and Compose reload require the exact `CONFIRM_METAMCP_OPERATION` confirmation value. No tool accepts an arbitrary hostname, container name, path, or shell command.
