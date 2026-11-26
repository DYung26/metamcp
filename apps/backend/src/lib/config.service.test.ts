import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repositories/config.repo", () => ({
  configRepo: {
    getConfig: vi.fn(),
    getConfigs: vi.fn(),
    setConfig: vi.fn(),
  },
}));

import { configRepo } from "../db/repositories/config.repo";
import { configService } from "./config.service";

const getConfig = vi.mocked(configRepo.getConfig);
const getConfigs = vi.mocked(configRepo.getConfigs);

describe("configService.getMcpResetTimeoutOnProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to enabled when no configuration exists", async () => {
    getConfig.mockResolvedValue(undefined);

    await expect(configService.getMcpResetTimeoutOnProgress()).resolves.toBe(
      true,
    );
  });

  it("returns false when explicitly disabled", async () => {
    getConfig.mockResolvedValue({
      id: "MCP_RESET_TIMEOUT_ON_PROGRESS",
      value: "false",
    });

    await expect(configService.getMcpResetTimeoutOnProgress()).resolves.toBe(
      false,
    );
  });
});

describe("configService.getMcpExecutionConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads execution settings in one query and applies defaults", async () => {
    getConfigs.mockResolvedValue([]);

    await expect(configService.getMcpExecutionConfig()).resolves.toEqual({
      resetTimeoutOnProgress: true,
      timeout: 60000,
      maxTotalTimeout: 60000,
    });
    expect(getConfigs).toHaveBeenCalledTimes(1);
  });

  it("uses the configured execution settings", async () => {
    getConfigs.mockResolvedValue([
      { id: "MCP_RESET_TIMEOUT_ON_PROGRESS", value: "false" },
      { id: "MCP_TIMEOUT", value: "12000" },
      { id: "MCP_MAX_TOTAL_TIMEOUT", value: "45000" },
    ]);

    await expect(configService.getMcpExecutionConfig()).resolves.toEqual({
      resetTimeoutOnProgress: false,
      timeout: 12000,
      maxTotalTimeout: 45000,
    });
    expect(getConfigs).toHaveBeenCalledTimes(1);
  });
});
