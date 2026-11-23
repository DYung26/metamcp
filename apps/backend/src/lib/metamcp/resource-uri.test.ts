import { describe, expect, it } from "vitest";

import {
  addResourceServerUuid,
  getToolUiResourceServerUuids,
  getToolUiResourceUris,
} from "./resource-uri";

const resourceUri = "ui://skill-display/skill-display.html";

describe("getToolUiResourceUris", () => {
  it("reads nested and legacy metadata keys without duplicating the URI", () => {
    expect(
      getToolUiResourceUris({
        ui: { resourceUri },
        "ui/resourceUri": resourceUri,
      }),
    ).toEqual([resourceUri]);
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

describe("getToolUiResourceServerUuids", () => {
  it("resolves a resource to its advertising backend", () => {
    expect(
      getToolUiResourceServerUuids(resourceUri, [
        { serverUuid: "skilljack", meta: { ui: { resourceUri } } },
        {
          serverUuid: "other",
          meta: { ui: { resourceUri: "ui://other/app.html" } },
        },
      ]),
    ).toEqual(["skilljack"]);
  });

  it("deduplicates tools from one backend and exposes cross-backend collisions", () => {
    expect(
      getToolUiResourceServerUuids(resourceUri, [
        { serverUuid: "skilljack", meta: { ui: { resourceUri } } },
        { serverUuid: "skilljack", meta: { "ui/resourceUri": resourceUri } },
        { serverUuid: "another-server", meta: { ui: { resourceUri } } },
      ]),
    ).toEqual(["skilljack", "another-server"]);
  });

  it("returns no backend for an unadvertised resource", () => {
    expect(getToolUiResourceServerUuids(resourceUri, [])).toEqual([]);
  });
});

describe("addResourceServerUuid", () => {
  it("preserves distinct owners and deduplicates repeated advertisements", () => {
    const owners: Record<string, Set<string>> = {};

    addResourceServerUuid(owners, resourceUri, "skilljack");
    addResourceServerUuid(owners, resourceUri, "skilljack");
    addResourceServerUuid(owners, resourceUri, "another-server");

    expect([...owners[resourceUri]]).toEqual(["skilljack", "another-server"]);
  });
});
