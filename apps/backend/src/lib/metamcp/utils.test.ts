import type { DatabaseMcpServer, DatabaseOAuthSession } from "@repo/zod-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../db/repositories/oauth-sessions.repo", () => ({
  oauthSessionsRepository: {
    findByMcpServerUuid: vi.fn(),
    findByMcpServerUuids: vi.fn(),
  },
}));

import { oauthSessionsRepository } from "../../db/repositories/oauth-sessions.repo";
import { convertDbServersToParams } from "./utils";

const createServer = (uuid: string): DatabaseMcpServer => ({
  uuid,
  name: `server-${uuid}`,
  description: null,
  type: "SSE",
  command: null,
  args: [],
  env: {},
  url: "https://example.com/mcp",
  error_status: "NONE",
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  bearerToken: null,
  headers: {},
  forward_headers: {},
  user_id: null,
});

const createSession = (serverUuid: string): DatabaseOAuthSession => ({
  uuid: `session-${serverUuid}`,
  mcp_server_uuid: serverUuid,
  client_information: null,
  tokens: {
    access_token: `token-${serverUuid}`,
    token_type: "Bearer",
  },
  code_verifier: null,
  expected_state: null,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  updated_at: new Date("2026-01-01T00:00:00.000Z"),
});

describe("convertDbServersToParams", () => {
  const findByMcpServerUuids = vi.mocked(
    oauthSessionsRepository.findByMcpServerUuids,
  );
  const findByMcpServerUuid = vi.mocked(
    oauthSessionsRepository.findByMcpServerUuid,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads OAuth sessions in one query and preserves server association", async () => {
    const servers = [createServer("server-1"), createServer("server-2")];
    findByMcpServerUuids.mockResolvedValue([createSession("server-2")]);

    const result = await convertDbServersToParams(servers);

    expect(findByMcpServerUuids).toHaveBeenCalledTimes(1);
    expect(findByMcpServerUuids).toHaveBeenCalledWith(["server-1", "server-2"]);
    expect(findByMcpServerUuid).not.toHaveBeenCalled();
    expect(result["server-1"].oauth_tokens).toBeNull();
    expect(result["server-2"].oauth_tokens?.access_token).toBe(
      "token-server-2",
    );
  });

  it("skips the database query for an empty server list", async () => {
    await expect(convertDbServersToParams([])).resolves.toEqual({});
    expect(findByMcpServerUuids).not.toHaveBeenCalled();
    expect(findByMcpServerUuid).not.toHaveBeenCalled();
  });

  it("falls back to individual lookups if the batch query fails", async () => {
    const servers = [createServer("server-1"), createServer("server-2")];
    findByMcpServerUuids.mockRejectedValue(new Error("batch query failed"));
    findByMcpServerUuid
      .mockResolvedValueOnce(createSession("server-1"))
      .mockResolvedValueOnce(undefined);

    const result = await convertDbServersToParams(servers);

    expect(findByMcpServerUuid).toHaveBeenCalledTimes(2);
    expect(result["server-1"].oauth_tokens?.access_token).toBe(
      "token-server-1",
    );
    expect(result["server-2"].oauth_tokens).toBeNull();
  });
});
