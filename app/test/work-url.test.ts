// WORK 载体的地址解析契约。
// 路由真源：nibi-client PWA 的 `{endpointOrigin}/remote/v4`（见 relay/workUrl.ts 注释）。
import { describe, expect, it } from "vitest";

import { WORK_WEB_PATH, isNibiOrigin, resolveWorkUrl } from "../src/relay/workUrl";

describe("resolveWorkUrl", () => {
  it("默认拼 endpointOrigin + /remote/v4", () => {
    expect(resolveWorkUrl("https://api.nibistudio.cn")).toBe(
      "https://api.nibistudio.cn/remote/v4",
    );
    expect(WORK_WEB_PATH).toBe("/remote/v4");
  });

  it("末尾斜杠不会拼出双斜杠", () => {
    expect(resolveWorkUrl("https://api.nibistudio.cn/")).toBe(
      "https://api.nibistudio.cn/remote/v4",
    );
    expect(resolveWorkUrl("https://api.nibistudio.cn///")).toBe(
      "https://api.nibistudio.cn/remote/v4",
    );
  });
});

describe("isNibiOrigin", () => {
  it("同源为真，跨源为假（决定 WebView 内跳转与 cookie 共享）", () => {
    expect(isNibiOrigin("https://api.nibistudio.cn/remote/v4", "https://api.nibistudio.cn")).toBe(true);
    expect(isNibiOrigin("https://auth.nibistudio.cn/oauth/v2/authorize", "https://api.nibistudio.cn")).toBe(
      false,
    );
    expect(isNibiOrigin("not a url", "https://api.nibistudio.cn")).toBe(false);
  });
});
