import { beforeEach, describe, expect, it, vi } from "vitest";

import { metamcpLogStore } from "./log-store";

vi.mock("@/utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("MetaMcpLogStore", () => {
  beforeEach(() => {
    metamcpLogStore.clearLogs();
  });

  it("retains the newest 1,000 logs in reverse chronological order", () => {
    for (let index = 0; index < 1_005; index++) {
      metamcpLogStore.addLog("server", "info", `log-${index}`);
    }

    const logs = metamcpLogStore.getLogs();

    expect(metamcpLogStore.getLogCount()).toBe(1_000);
    expect(logs).toHaveLength(1_000);
    expect(logs[0].message).toBe("log-1004");
    expect(logs.at(-1)?.message).toBe("log-5");
  });

  it("returns only the requested newest logs", () => {
    for (let index = 0; index < 5; index++) {
      metamcpLogStore.addLog("server", "info", `log-${index}`);
    }

    expect(metamcpLogStore.getLogs(2).map((log) => log.message)).toEqual([
      "log-4",
      "log-3",
    ]);
  });

  it("resets ring-buffer indices when cleared", () => {
    for (let index = 0; index < 1_005; index++) {
      metamcpLogStore.addLog("server", "info", `log-${index}`);
    }

    metamcpLogStore.clearLogs();
    metamcpLogStore.addLog("server", "info", "after-clear");

    expect(metamcpLogStore.getLogCount()).toBe(1);
    expect(metamcpLogStore.getLogs().map((log) => log.message)).toEqual([
      "after-clear",
    ]);
  });
});
