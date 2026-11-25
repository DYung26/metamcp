import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import logger from "@/utils/logger";

import { SessionLifetimeManagerImpl } from "./session-lifetime-manager.js";

const { getSessionLifetime } = vi.hoisted(() => ({
  getSessionLifetime: vi.fn(),
}));

vi.mock("./config.service", () => ({
  configService: { getSessionLifetime },
}));

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), error: vi.fn() },
}));

describe("SessionLifetimeManagerImpl", () => {
  let manager: SessionLifetimeManagerImpl<{ value: string }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    getSessionLifetime.mockReset();
    getSessionLifetime.mockResolvedValue(1_000);
    manager = new SessionLifetimeManagerImpl("test");
  });

  afterEach(() => {
    manager.stopCleanupTimer();
    vi.useRealTimers();
  });

  it("summarizes session ages without exposing session identifiers", () => {
    manager.addSession("one", { value: "one" });
    vi.advanceTimersByTime(1_000);
    manager.addSession("two", { value: "two" });
    vi.advanceTimersByTime(2_000);

    expect(manager.getSessionAgeMetrics()).toEqual({
      count: 2,
      newestMs: 2_000,
      averageMs: 2_500,
      p95Ms: 3_000,
      oldestMs: 3_000,
    });
  });

  it("keeps total age separate from idle age after activity", () => {
    manager.addSession("session-a", { value: "a" });
    vi.advanceTimersByTime(5_000);
    manager.touchSession("session-a");

    expect(manager.getSessionAge("session-a")).toBe(5_000);
    expect(manager.getSessionAgeMetrics().oldestMs).toBe(5_000);
    expect(manager.getSessionIdleAgeMetrics().oldestMs).toBe(0);
  });

  it("does not run overlapping cleanup callbacks for the same session", async () => {
    manager.addSession("session-a", { value: "a" });
    vi.advanceTimersByTime(2_000);

    let releaseCleanup!: () => void;
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCleanup = resolve;
        }),
    );

    const firstSweep = manager.cleanupExpiredSessions(cleanup);
    // Let the first sweep claim the session and enter its callback.
    await Promise.resolve();
    const secondSweep = manager.cleanupExpiredSessions(cleanup);
    await secondSweep;

    expect(cleanup).toHaveBeenCalledTimes(1);
    releaseCleanup();
    await firstSweep;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("releases the cleanup claim when a callback fails", async () => {
    manager.addSession("session-a", { value: "a" });
    vi.advanceTimersByTime(2_000);
    const cleanup = vi
      .fn()
      .mockRejectedValueOnce(new Error("close failed"))
      .mockResolvedValueOnce(undefined);

    await manager.cleanupExpiredSessions(cleanup);
    await manager.cleanupExpiredSessions(cleanup);

    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("does not close a session that was touched after the sweep snapshot", async () => {
    manager.addSession("session-a", { value: "a" });
    vi.advanceTimersByTime(2_000);

    vi.mocked(logger.info).mockImplementationOnce(() => {
      // The expired-session snapshot has been taken before this log runs.
      manager.touchSession("session-a");
    });

    const cleanup = vi.fn().mockResolvedValue(undefined);
    await manager.cleanupExpiredSessions(cleanup);

    expect(cleanup).not.toHaveBeenCalled();
  });
});
