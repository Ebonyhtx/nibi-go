import { describe, expect, it } from "vitest";

import { buildRedirectUri } from "../src/relay/redirectUri";

describe("buildRedirectUri", () => {
  it("输出 <scheme>://login，不能出现三个斜杠", () => {
    expect(buildRedirectUri("nibigo")).toBe("nibigo://login");
    expect(buildRedirectUri("nibigo")).not.toContain("///");
  });

  it("app config 声明多个 scheme 时取第一个", () => {
    expect(buildRedirectUri(["nibigo", "nibi-go"])).toBe("nibigo://login");
  });

  it("scheme 缺失或为空时回落到 nibigo", () => {
    expect(buildRedirectUri(undefined)).toBe("nibigo://login");
    expect(buildRedirectUri("   ")).toBe("nibigo://login");
    expect(buildRedirectUri([])).toBe("nibigo://login");
  });
});
