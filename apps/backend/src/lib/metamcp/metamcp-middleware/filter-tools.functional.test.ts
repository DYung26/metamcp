import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db/index", () => ({ db: { select: vi.fn() } }));

import { db } from "../../../db/index";
import {
  clearFilterCache,
  createFilterCallToolMiddleware,
  createFilterListToolsMiddleware,
} from "./filter-tools.functional";
import { MetaMCPHandlerContext } from "./functional-middleware";

const context: MetaMCPHandlerContext = {
  endpointName: "test-endpoint",
  namespaceUuid: "namespace-a",
  sessionId: "session-a",
};

const tools: Tool[] = [
  {
    name: "server__active",
    description: "Active tool",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "server__inactive",
    description: "Inactive tool",
    inputSchema: { type: "object", properties: {} },
  },
];

function mockInactiveMappings(
  rows: Array<{ serverName: string; toolName: string }>,
): void {
  vi.mocked(db.select).mockImplementation(() => {
    const query = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn().mockResolvedValue(rows),
    };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    return query as never;
  });
}

function mockSelectResults(
  results: Array<Array<{ uuid?: string; status?: "ACTIVE" | "INACTIVE" }>>,
): void {
  const queuedResults = [...results];
  vi.mocked(db.select).mockImplementation(() => {
    const query = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi
        .fn()
        .mockImplementation(() => Promise.resolve(queuedResults.shift() ?? [])),
    };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    return query as never;
  });
}

async function listTools(
  options: { cacheEnabled?: boolean; cacheTTL?: number } = {},
  namespaceUuid = context.namespaceUuid,
) {
  const middleware = createFilterListToolsMiddleware(options);
  const handler = vi.fn().mockResolvedValue({ tools });
  const result = await middleware(handler)(
    { method: "tools/list", params: {} } as never,
    { ...context, namespaceUuid },
  );
  return { result, handler };
}

async function callTool(
  options: { cacheEnabled?: boolean; cacheTTL?: number } = {},
  namespaceUuid = context.namespaceUuid,
) {
  const middleware = createFilterCallToolMiddleware(options);
  const handler = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "ok" }],
  });
  const result = await middleware(handler)(
    {
      method: "tools/call",
      params: { name: "server__inactive", arguments: {} },
    } as never,
    { ...context, namespaceUuid },
  );
  return { result, handler };
}

describe("createFilterListToolsMiddleware", () => {
  beforeEach(() => {
    clearFilterCache();
    vi.clearAllMocks();
    mockInactiveMappings([{ serverName: "server", toolName: "inactive" }]);
  });

  it("filters inactive tools and reuses the namespace result within the TTL", async () => {
    const first = await listTools();
    const second = await listTools();
    expect(first.result.tools).toEqual([tools[0]]);
    expect(second.result.tools).toEqual([tools[0]]);
    expect(first.handler).toHaveBeenCalledOnce();
    expect(second.handler).toHaveBeenCalledOnce();
    expect(db.select).toHaveBeenCalledOnce();
  });

  it("does not cache when caching is disabled", async () => {
    await listTools({ cacheEnabled: false });
    await listTools({ cacheEnabled: false });
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("isolates cached inactive tools by namespace", async () => {
    await listTools();
    await listTools({}, "namespace-b");
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("invalidates cached namespace data through clearFilterCache", async () => {
    await listTools();
    clearFilterCache(context.namespaceUuid);
    await listTools();
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("caches an empty inactive set", async () => {
    mockInactiveMappings([]);
    const first = await listTools();
    const second = await listTools();
    expect(first.result.tools).toEqual(tools);
    expect(second.result.tools).toEqual(tools);
    expect(db.select).toHaveBeenCalledOnce();
  });

  it("bounds cache growth when many namespaces are visited", async () => {
    for (let index = 0; index <= 256; index += 1) {
      await listTools({}, `namespace-${index}`);
    }

    await listTools({}, "namespace-0");
    expect(db.select).toHaveBeenCalledTimes(258);
  });
});

describe("createFilterCallToolMiddleware", () => {
  beforeEach(() => {
    clearFilterCache();
    vi.clearAllMocks();
  });

  it("caches server and tool status lookups for repeated calls", async () => {
    mockSelectResults([[{ uuid: "server-uuid" }], [{ status: "INACTIVE" }]]);

    const first = await callTool();
    const second = await callTool();

    expect(first.result.isError).toBe(true);
    expect(second.result.isError).toBe(true);
    expect(first.handler).not.toHaveBeenCalled();
    expect(second.handler).not.toHaveBeenCalled();
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("negative-caches a missing tool mapping", async () => {
    mockSelectResults([[{ uuid: "server-uuid" }], []]);

    const first = await callTool();
    const second = await callTool();

    expect(first.handler).toHaveBeenCalledOnce();
    expect(second.handler).toHaveBeenCalledOnce();
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("negative-caches a missing server", async () => {
    mockSelectResults([[]]);

    const first = await callTool();
    const second = await callTool();

    expect(first.handler).toHaveBeenCalledOnce();
    expect(second.handler).toHaveBeenCalledOnce();
    expect(db.select).toHaveBeenCalledOnce();
  });

  it("honors cacheEnabled=false", async () => {
    mockSelectResults([
      [{ uuid: "server-uuid" }],
      [{ status: "INACTIVE" }],
      [{ uuid: "server-uuid" }],
      [{ status: "INACTIVE" }],
    ]);

    await callTool({ cacheEnabled: false });
    await callTool({ cacheEnabled: false });

    expect(db.select).toHaveBeenCalledTimes(4);
  });

  it("scopes server UUID cache entries by namespace", async () => {
    mockSelectResults([
      [{ uuid: "server-a" }],
      [{ status: "INACTIVE" }],
      [{ uuid: "server-b" }],
      [{ status: "INACTIVE" }],
    ]);

    await callTool({}, "namespace-a");
    await callTool({}, "namespace-b");

    expect(db.select).toHaveBeenCalledTimes(4);
  });

  it("clears tool and server caches by namespace", async () => {
    mockSelectResults([
      [{ uuid: "server-uuid" }],
      [{ status: "INACTIVE" }],
      [{ uuid: "server-uuid" }],
      [{ status: "INACTIVE" }],
      [{ uuid: "server-uuid" }],
      [{ status: "INACTIVE" }],
    ]);

    await callTool();
    clearFilterCache(context.namespaceUuid);
    await callTool();
    expect(db.select).toHaveBeenCalledTimes(4);

    clearFilterCache();
    await callTool();
    expect(db.select).toHaveBeenCalledTimes(6);
  });
});
