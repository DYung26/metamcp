import { describe, expect, it } from "vitest";

import { createConcurrencyLimiter } from "./discovery-concurrency";

describe("createConcurrencyLimiter", () => {
  it("never runs more than the configured number of tasks concurrently", async () => {
    const run = createConcurrencyLimiter(3);
    let active = 0;
    let maximumActive = 0;

    await Promise.all(
      Array.from({ length: 15 }, () =>
        run(async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      ),
    );

    expect(maximumActive).toBe(3);
    expect(active).toBe(0);
  });

  it("preserves FIFO order across a large waiter queue", async () => {
    const run = createConcurrencyLimiter(1);
    let releaseFirst: (() => void) | undefined;
    const first = run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const order: number[] = [];
    const queued = Array.from({ length: 2000 }, (_, index) =>
      run(async () => {
        order.push(index);
      }),
    );

    releaseFirst?.();
    await Promise.all([first, ...queued]);

    expect(order).toEqual(Array.from({ length: 2000 }, (_, index) => index));
  });

  it("releases the slot after a task rejects", async () => {
    const run = createConcurrencyLimiter(1);
    await expect(
      run(async () => {
        throw new Error("expected");
      }),
    ).rejects.toThrow("expected");

    await expect(run(async () => "next task")).resolves.toBe("next task");
  });
});
