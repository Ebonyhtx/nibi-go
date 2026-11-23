import { describe, expect, it, vi } from "vitest";

vi.mock("../src/plugins/store", () => ({
  pluginKernelId: (plugin: { kernelName?: string; parsed: { manifest: { id: string } } }) =>
    plugin.kernelName ?? plugin.parsed.manifest.id,
}));

import { parseComposerText } from "../src/plugins/tokens";

describe("composer token parser", () => {
  it("parses escaped plugin labels cleanly", () => {
    const parsed = parseComposerText(
      String.raw`[@A \[B\] \\ C](plugin://acme.weather@inline) check rain`,
    );
    expect(parsed.tokens).toEqual([
      { kind: "plugin", label: "A [B] \\ C" },
    ]);
    expect(parsed.body).toBe("check rain");
  });

  it("handles pathological unclosed plugin mentions without ReDoS", () => {
    const start = Date.now();
    const evil = `[@${"\\\\".repeat(10_000)}`;
    const parsed = parseComposerText(evil);
    expect(parsed.tokens).toEqual([]);
    expect(parsed.body).toBe(evil);
    expect(Date.now() - start).toBeLessThan(200);
  });
});
