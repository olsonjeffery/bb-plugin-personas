// Pure policy tests for plugin-health.ts — which installed-plugin states
// count as available, and when the install link appears. The RPC-level path
// (one fresh plugins.list read per call) is covered in server.test.ts.
import { describe, expect, it } from "vitest";
import {
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
