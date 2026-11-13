export const METAMCP_HOSTS = {
  vps: {
    label: "VPS",
    hostname: "localhost",
    url: "https://vps-mcp.dyung.me",
    container: "metamcp",
    composeDirectory: "/home/dyung/Projects/metamcp",
    composeProject: "metamcp",
    composeService: "app",
  },
  arch: {
    label: "Arch Linux",
    hostname: "arch",
    url: "https://arch-mcp.dyung.me",
    container: "metamcp",
    composeDirectory: "/home/dyung/Projects/metamcp",
    composeProject: "metamcp",
    composeService: "app",
  },
  omarchy: {
    label: "Omarchy",
    hostname: "omarchy",
    url: "https://omarchy-mcp.dyung.me",
    container: "metamcp",
    composeDirectory: "/home/dyung/Projects/metamcp",
    composeProject: "metamcp",
    composeService: "app",
  },
} as const;

export type MetaMcpHostId = keyof typeof METAMCP_HOSTS;
export type ContainerAction = "start" | "stop" | "restart";
