import { homedir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";

import { METAMCP_HOSTS, type ContainerAction, type MetaMcpHostId } from "./hosts";

const SSH_CONNECT_TIMEOUT_SECONDS = 8;
const SSH_KNOWN_HOSTS_FILE = join(homedir(), ".config", "metamcp-ops", "known_hosts");
const SSH_COMMAND_TIMEOUT_MS = 30_000;
const MAX_LOG_LINES = 500;
const DEFAULT_LOG_LINES = 100;

function getHost(hostId: MetaMcpHostId) {
  return METAMCP_HOSTS[hostId];
}

async function runRemoteCommand(
  hostId: MetaMcpHostId,
  command: string,
  timeout = SSH_COMMAND_TIMEOUT_MS,
): Promise<string> {
  const host = getHost(hostId);
  const { stdout } = await execa(
    "ssh",
    [
      "-o", "BatchMode=yes",
      "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
      "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${SSH_KNOWN_HOSTS_FILE}`,
      host.hostname,
      command,
    ],
    { timeout, reject: true, maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout;
}

export async function checkHostHealth(hostId: MetaMcpHostId) {
  const host = getHost(hostId);
  const response = await fetch(new URL("/health", host.url), {
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "application/json" },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${host.label} health check failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  let health: { status?: string };
  try {
    health = JSON.parse(body) as { status?: string };
  } catch {
    throw new Error(`${host.label} returned an invalid health response`);
  }

  return {
    host: hostId,
    url: host.url,
    httpStatus: response.status,
    status: health.status ?? "unknown",
    healthy: health.status === "ok",
    checkedAt: new Date().toISOString(),
  };
}

export async function inspectContainer(hostId: MetaMcpHostId) {
  const host = getHost(hostId);
  const output = await runRemoteCommand(
    hostId,
    `docker inspect --format '{{json .State}}' ${host.container}`,
  );
  const state = JSON.parse(output) as {
    Status: string;
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    OOMKilled: boolean;
    ExitCode: number;
    StartedAt: string;
    FinishedAt: string;
    Health?: { Status: string; FailingStreak: number };
  };

  const [image, restartPolicy] = await Promise.all([
    runRemoteCommand(hostId, `docker inspect --format '{{.Config.Image}}' ${host.container}`),
    runRemoteCommand(hostId, `docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' ${host.container}`),
  ]);

  return {
    host: hostId,
    container: host.container,
    image: image.trim(),
    restartPolicy: restartPolicy.trim(),
    state: {
      status: state.Status,
      running: state.Running,
      paused: state.Paused,
      restarting: state.Restarting,
      oomKilled: state.OOMKilled,
      exitCode: state.ExitCode,
      startedAt: state.StartedAt,
      finishedAt: state.FinishedAt,
      health: state.Health?.Status ?? "not-configured",
      healthFailingStreak: state.Health?.FailingStreak ?? 0,
    },
    inspectedAt: new Date().toISOString(),
  };
}

export async function getContainerLogs(hostId: MetaMcpHostId, lines = DEFAULT_LOG_LINES) {
  const boundedLines = Math.min(Math.max(Math.trunc(lines), 1), MAX_LOG_LINES);
  const host = getHost(hostId);
  const output = await runRemoteCommand(
    hostId,
    `docker logs --timestamps --tail ${boundedLines} ${host.container} 2>&1`,
  );
  return { host: hostId, container: host.container, lines: boundedLines, logs: output };
}

export async function performContainerAction(hostId: MetaMcpHostId, action: ContainerAction) {
  const host = getHost(hostId);
  await runRemoteCommand(
    hostId,
    `docker ${action} ${host.container}`,
    action === "stop" ? 45_000 : 90_000,
  );
  const resultingStatus = await runRemoteCommand(
    hostId,
    `docker inspect --format '{{.State.Status}}' ${host.container}`,
  );
  return {
    host: hostId,
    container: host.container,
    action,
    resultingStatus: resultingStatus.trim(),
    completedAt: new Date().toISOString(),
  };
}

export async function reloadComposeService(hostId: MetaMcpHostId) {
  const host = getHost(hostId);
  const output = await runRemoteCommand(
    hostId,
    `cd '${host.composeDirectory}' && docker compose --project-name ${host.composeProject} up -d --no-deps --force-recreate ${host.composeService} && docker inspect --format '{{.State.Status}}' ${host.container}`,
    120_000,
  );
  return {
    host: hostId,
    container: host.container,
    composeProject: host.composeProject,
    composeService: host.composeService,
    resultingStatus: output.trim(),
    completedAt: new Date().toISOString(),
  };
}
