import { describe, expect, it } from "vitest";

import { compareVersions, parseVersion, satisfiesMinApp } from "../src";

describe("版本比较", () => {
  it("解析 1 / 1.2 / 1.2.3 与预发布后缀", () => {
    expect(parseVersion("1")).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(parseVersion("1.2")).toEqual({ major: 1, minor: 2, patch: 0 });
    expect(parseVersion("1.2.3-beta.1")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("latest")).toBeNull();
  });

  it("按数字核心比较", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("x", "1.0.0")).toBeNull();
  });

  it("minApp 缺失视为满足；坏版本不满足", () => {
    expect(satisfiesMinApp("0.1.0", undefined)).toBe(true);
    expect(satisfiesMinApp("0.1.0", "0.1.0")).toBe(true);
    expect(satisfiesMinApp("0.1.0", "0.1.1")).toBe(false);
    expect(satisfiesMinApp("0.1.0", "latest")).toBe(false);
  });
});