import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repositories/config.repo", () => ({
  configRepo: {
    getConfig: vi.fn(),
    setConfig: vi.fn(),
  },
}));

import { configRepo } from "../db/repositories/config.repo";
import { configService } from "./config.service";

const getConfig = vi.mocked(configRepo.getConfig);

describe("configService.getMcpResetTimeoutOnProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to enabled when no configuration exists", async () => {
    getConfig.mockResolvedValue(undefined);

    await expect(configService.getMcpResetTimeoutOnProgress()).resolves.toBe(true);
  });

  it("returns false when explicitly disabled", async () => {
    getConfig.mockResolvedValue({ id: "MCP_RESET_TIMEOUT_ON_PROGRESS", value: "false" });

    await expect(configService.getMcpResetTimeoutOnProgress()).resolves.toBe(false);
  });
});
