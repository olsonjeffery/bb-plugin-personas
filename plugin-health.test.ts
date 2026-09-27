// Pure policy tests for plugin-health.ts — which installed-plugin states
// count as available, and when the install link appears. The RPC-level path
// (one fresh plugins.list read per call) is covered in server.test.ts.
import { describe, expect, it } from "vitest";
import {
  DOCS_PLUGIN_ID,
  DOCS_PLUGIN_URL,
  FLOATING_NOTES_PLUGIN_ID,
  FLOATING_NOTES_PLUGIN_URL,
  isFloatingNotesAvailable,
  pluginHealth,
  type InstalledPluginSummary,
} from "./plugin-health.js";

function makePlugin(
  overrides: Partial<InstalledPluginSummary>,
): InstalledPluginSummary {
  return {
    id: FLOATING_NOTES_PLUGIN_ID,
    enabled: true,
    status: "running",
    version: "1.2.1",
    ...overrides,
  };
}

describe("isFloatingNotesAvailable", () => {
  it.each(["running", "needs-configuration", "degraded"] as const)(
    "is true when Floating Notes is installed, enabled, and %s",
    (status) => {
      expect(
        isFloatingNotesAvailable([makePlugin({ status })]),
      ).toBe(true);
    },
  );

  it.each(["disabled", "missing", "error", "incompatible"] as const)(
    "is false when Floating Notes is %s",
    (status) => {
      expect(
        isFloatingNotesAvailable([makePlugin({ status })]),
      ).toBe(false);
    },
  );

  it("is false when Floating Notes is not in the installed list at all", () => {
    expect(
      isFloatingNotesAvailable([
        { id: "personas", enabled: true, status: "running", version: "1.2.0" },
      ]),
    ).toBe(false);
  });

  it("is false for an enabled-but-disabled row (enabled flag wins over status text)", () => {
    expect(
      isFloatingNotesAvailable([makePlugin({ enabled: false, status: "running" })]),
    ).toBe(false);
  });
});

describe("pluginHealth", () => {
  it("matches the floating-notes row's available flag", () => {
    expect(pluginHealth([makePlugin({})]).floatingNotesAvailable).toBe(true);
    expect(pluginHealth([makePlugin({ enabled: false })]).floatingNotesAvailable)
      .toBe(false);
  });

  it("carries the plugin page link only while the tool is missing", () => {
    const missing = pluginHealth([]).tools[0]!;
    expect(missing.installUrl).toBe(FLOATING_NOTES_PLUGIN_URL);
    expect(missing.installed).toBe(false);

    const present = pluginHealth([makePlugin({})]).tools[0]!;
    expect(present.installUrl).toBeNull();
    expect(present.installed).toBe(true);
  });
});

describe("pluginHealth docs row", () => {
  // Docs is official and ships with bb, so an absent row is unusual but the
  // same rule as Floating Notes applies — present, enabled, no hard failure.
  it("is available when Docs is installed, enabled, and running", () => {
    const docs = pluginHealth([makePlugin({ id: DOCS_PLUGIN_ID })]).tools[1]!;
    expect(docs).toMatchObject({
      id: DOCS_PLUGIN_ID,
      label: "Docs",
      installed: true,
      enabled: true,
      available: true,
      installUrl: null,
    });
  });

  it("carries the official plugin page link only while Docs is missing", () => {
    const docs = pluginHealth([]).tools[1]!;
    expect(docs).toMatchObject({
      id: DOCS_PLUGIN_ID,
      label: "Docs",
      installed: false,
      available: false,
      installUrl: DOCS_PLUGIN_URL,
    });

    const present = pluginHealth([makePlugin({ id: DOCS_PLUGIN_ID })])
      .tools[1]!;
    expect(present.installUrl).toBeNull();
    expect(present.installed).toBe(true);
  });

  it("is unavailable when Docs is installed but disabled", () => {
    const docs = pluginHealth([
      makePlugin({ id: DOCS_PLUGIN_ID, enabled: false, status: "disabled" }),
    ]).tools[1]!;
    expect(docs).toMatchObject({
      installed: true,
      enabled: false,
      available: false,
      // Installed, so no install link — enable it instead.
      installUrl: null,
    });
  });
});
