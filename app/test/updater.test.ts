import { describe, expect, it } from "vitest";

import {
  compareVersions,
  digestMatches,
  parseVersion,
  resolveUpdate,
  selectApkAsset,
} from "../src/relay/updater-core";

describe("updater-core（应用内更新纯函数）", () => {
  it("版本解析与比较（含预发布）", () => {
    expect(parseVersion("v1.2.3")).toEqual({ parts: [1, 2, 3], prerelease: null });
    expect(parseVersion("1.2.3-beta.1")).toEqual({ parts: [1, 2, 3], prerelease: "beta.1" });
    expect(parseVersion("abc")).toBeNull();
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.2", "1.2.3")).toBe(-1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    // 正式版 > 预发布
    expect(compareVersions("1.2.3", "1.2.3-beta.1")).toBe(1);
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(-1);
    expect(compareVersions("bad", "1.2.3")).toBeNull();
  });

  it("APK 资产选择：优先 arm64，避开 x86/debug", () => {
    expect(
      selectApkAsset({
        tag_name: "v1.0.0",
        assets: [
          { name: "app-x86-debug.apk", browser_download_url: "u1" },
          { name: "app-arm64-v8a.apk", browser_download_url: "u2" },
          { name: "app-universal.apk", browser_download_url: "u3" },
        ],
      })?.browser_download_url,
    ).toBe("u2");
    expect(
      selectApkAsset({
        tag_name: "v1.0.0",
        assets: [{ name: "app-universal.apk", browser_download_url: "u3" }],
      })?.browser_download_url,
    ).toBe("u3");
    expect(selectApkAsset({ tag_name: "v1.0.0", assets: [] })).toBeNull();
  });

  it("resolveUpdate：仅新版本且非预发布/草稿；digest 转 sha256", () => {
    const release = {
      tag_name: "v0.2.0",
      body: "新版本说明",
      assets: [
        {
          name: "nibi-go-arm64.apk",
          browser_download_url: "https://example.com/a.apk",
          digest: "sha256:ABCDEF",
          size: 1234,
        },
      ],
    };
    expect(resolveUpdate(release, "0.1.0")).toEqual({
      version: "0.2.0",
      notes: "新版本说明",
      apkUrl: "https://example.com/a.apk",
      sha256: "abcdef",
      size: 1234,
    });
    expect(resolveUpdate(release, "0.2.0")).toBeNull();
    expect(resolveUpdate(release, "0.3.0")).toBeNull();
    expect(resolveUpdate({ ...release, prerelease: true }, "0.1.0")).toBeNull();
    expect(resolveUpdate({ ...release, draft: true }, "0.1.0")).toBeNull();
    expect(resolveUpdate({ ...release, assets: [] }, "0.1.0")).toBeNull();
  });

  it("digestMatches：大小写不敏感；无期望值判失败（fail-closed）", () => {
    expect(digestMatches("ABCD", "abcd")).toBe(true);
    expect(digestMatches("abcd", "abce")).toBe(false);
    expect(digestMatches(undefined, "anything")).toBe(false);
    expect(digestMatches("", "anything")).toBe(false);
  });
});
