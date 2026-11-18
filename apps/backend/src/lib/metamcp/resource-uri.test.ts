import { describe, expect, it } from "vitest";

import { getToolUiResourceUris } from "./resource-uri";

describe("getToolUiResourceUris", () => {
  it("reads the nested and legacy flat MCP Apps metadata keys", () => {
    expect(
      getToolUiResourceUris({
        ui: { resourceUri: "ui://skill-display/skill-display.html" },
        "ui/resourceUri": "ui://skill-display/skill-display.html",
      }),
    ).toEqual(["ui://skill-display/skill-display.html"]);
  });

  it("ignores missing, non-string, and non-UI resource URIs", () => {
    expect(getToolUiResourceUris(undefined)).toEqual([]);
    expect(
      getToolUiResourceUris({
        ui: { resourceUri: 42 },
        "ui/resourceUri": "https://example.com/app.html",
      }),
    ).toEqual([]);
  });
});
