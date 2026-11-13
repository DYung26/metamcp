import { describe, expect, it } from "vitest";

import { prioritizeAdminTools } from "./tool-list-prioritization";

type TestTool = { name: string };

function tools(prefix: string, count: number): TestTool[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}__tool_${String(index).padStart(3, "0")}`,
  }));
}

describe("prioritizeAdminTools", () => {
  it("places every admin tool before namespace tools and reserves their slots", () => {
    const adminTools = tools("metamcp-admin", 3);
    const namespaceTools = [...tools("alpha", 10), ...tools("beta", 10)];

    const result = prioritizeAdminTools(namespaceTools, adminTools, 5);

    expect(result.slice(0, adminTools.length)).toEqual(adminTools);
    expect(result).toHaveLength(5);
    expect(result.slice(adminTools.length)).toHaveLength(2);
  });

  it("keeps all 52 admin tools on the first 100-tool page for a large namespace", () => {
    const adminTools = tools("metamcp-admin", 52);
    const namespaceTools = [
      ...tools("google-workspace", 1200),
      ...tools("openship", 500),
      ...tools("other", 337),
    ];

    const result = prioritizeAdminTools(namespaceTools, adminTools, 1000);
    const firstPage = result.slice(0, 100);

    expect(result).toHaveLength(1000);
    expect(
      firstPage.filter((tool) => tool.name.startsWith("metamcp-admin__")),
    ).toHaveLength(52);
    expect(firstPage.slice(0, 52)).toEqual(adminTools);
  });

  it("keeps all admin tools in every partition while preserving partition overflow checks", () => {
    const adminTools = tools("metamcp-admin", 2);
    const partitionTools = tools("namespace", 3);

    const result = prioritizeAdminTools(partitionTools, adminTools, 5, {
      partitioned: true,
    });

    expect(result).toEqual([...adminTools, ...partitionTools]);
    expect(() =>
      prioritizeAdminTools(partitionTools, adminTools, 4, {
        partitioned: true,
      }),
    ).toThrow(/Increase toolPartitions/);
  });

  it("fails clearly when the configured cap cannot fit all admin tools", () => {
    expect(() =>
      prioritizeAdminTools(tools("namespace", 1), tools("metamcp-admin", 3), 2),
    ).toThrow(/Increase it to expose all admin tools/);
  });
});
