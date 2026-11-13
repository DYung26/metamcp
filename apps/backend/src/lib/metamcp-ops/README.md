# MetaMCP Operations MCP

This service exposes a separate infrastructure-control MCP endpoint for the three fixed MetaMCP installations: `vps`, `arch`, and `omarchy`.

Run it as a host-level process on the VPS, not inside the MetaMCP application container. The process uses the VPS Docker CLI for its local container and the VPS SSH configuration for the Arch and Omarchy containers. The SSH identity must be able to run Docker commands on those two hosts without an interactive prompt.

## Configuration

- `METAMCP_OPS_API_KEY`: required bearer token. Keep it in a service-user-readable environment file, never in source control.
- `METAMCP_OPS_PORT`: optional listener port; defaults to `12010`. The process binds to loopback.

Expose the service through the VPS Cloudflare Tunnel using a dedicated hostname and keep the origin bound to loopback. Configure the MetaMCP upstream with `Authorization: Bearer <METAMCP_OPS_API_KEY>`.

## Tools

- `metamcp_ops_list_hosts`: list the fixed managed hosts.
- `metamcp_ops_get_host_status`: fetch public health and Docker state for one or all hosts.
- `metamcp_ops_get_container_logs`: read up to 500 recent log lines.
- `metamcp_ops_container_action`: start, stop, or restart the fixed `metamcp` container.
- `metamcp_ops_reload_compose_service`: recreate only the `app` Compose service. It does not pull images, restart Postgres, or modify volumes.

Container actions and Compose reload require the exact `CONFIRM_METAMCP_OPERATION` confirmation value. No tool accepts an arbitrary hostname, container name, path, or shell command.
