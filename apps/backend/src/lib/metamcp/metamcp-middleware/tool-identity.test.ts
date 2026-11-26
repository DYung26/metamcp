import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { createToolIdentityResolver } from "./tool-identity";

describe("createToolIdentityResolver", () => {
  it("resolves mapped tools without querying the fallback", async () => {
    const fallback = vi.fn().mockResolvedValue({});
    const resolveIdentity = createToolIdentityResolver(
      { calendar__list_events: "server-uuid" },
      new Map([["server-uuid", "Calendar Server"]]),
      fallback,
    );

    await expect(resolveIdentity("calendar__list_events")).resolves.toEqual({
      mcpServerUuid: "server-uuid",
      mcpServerName: "Calendar Server",
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("resolves nested tool names through their exact mapping", async () => {
    const resolveIdentity = createToolIdentityResolver(
      { parent__child__run: "server-uuid" },
      new Map([["server-uuid", "Parent Server"]]),
      vi.fn(),
    );

    await expect(resolveIdentity("parent__child__run")).resolves.toEqual({
      mcpServerUuid: "server-uuid",
      mcpServerName: "Parent Server",
    });
  });

  it("falls back when the tool has no in-memory mapping", async () => {
    const fallback = vi.fn().mockResolvedValue({ mcpServerName: "Unknown" });
    const resolveIdentity = createToolIdentityResolver({}, new Map(), fallback);

    await expect(resolveIdentity("missing__tool")).resolves.toEqual({
      mcpServerName: "Unknown",
    });
    expect(fallback).toHaveBeenCalledWith("missing__tool");
  });
  it("resolves 10,000 mapped tools without database fallbacks", async () => {
    const toolServerUuidByName = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [
        `server__tool_${index}`,
        `server-${index % 100}`,
      ]),
    );
    const serverNameByUuid = new Map(
      Array.from({ length: 100 }, (_, index) => [
        `server-${index}`,
        `Server ${index}`,
      ]),
    );
    const fallback = vi.fn().mockResolvedValue({});
    const resolveIdentity = createToolIdentityResolver(
      toolServerUuidByName,
      serverNameByUuid,
      fallback,
    );

    const identities = await Promise.all(
      Array.from({ length: 10_000 }, (_, index) =>
        resolveIdentity(`server__tool_${index}`),
      ),
    );

    expect(identities).toHaveLength(10_000);
    expect(fallback).not.toHaveBeenCalled();
  });
});
