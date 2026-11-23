import { describe, expect, it } from "vitest";

import {
  compareVersions,
  digestMatches,
  parseUpdateManifest,
  parseVersion,
  resolveManifestUpdate,
  resolveUpdate,
  selectApkAsset,
  type UpdateManifest,
} from "../src/relay/updater-core";

function manifest(overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    schemaVersion: 1,
    kind: "nibi-go-app-update",
    generatedAt: "2026-11-25T00:00:00.000Z",
    version: "0.1.9",
    versionCode: 10,
    apk: {
      sha256: "a".repeat(64),
      size: 1234,
      urls: [
        "https://cdn.example.com/nibi-go-10.apk",
        "https://github.com/example/releases/download/v0.1.9/app.apk",
      ],
    },
    ...overrides,
  };
}

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
      urls: ["https://example.com/a.apk"],
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

describe("update.json 签名清单", () => {
  it("解析合法清单并去重 URL", () => {
    const parsed = parseUpdateManifest(
      manifest({
        apk: {
          sha256: "b".repeat(64),
          size: 2048,
          urls: ["https://cdn.example.com/a.apk", "https://cdn.example.com/a.apk"],
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.manifest.versionCode).toBe(10);
    expect(parsed.manifest.apk.urls).toEqual(["https://cdn.example.com/a.apk"]);
  });

  it("拒绝错误 kind、versionCode、摘要与非 https 地址", () => {
    expect(parseUpdateManifest({ ...manifest(), kind: "other" }).ok).toBe(false);
    expect(parseUpdateManifest({ ...manifest(), versionCode: 0 }).ok).toBe(false);
    expect(
      parseUpdateManifest({
        ...manifest(),
        apk: { ...manifest().apk, sha256: "zz" },
      }).ok,
    ).toBe(false);
    expect(
      parseUpdateManifest({
        ...manifest(),
        apk: { ...manifest().apk, urls: ["http://cdn.example.com/a.apk"] },
      }).ok,
    ).toBe(false);
  });

  it("resolveManifestUpdate 以 versionCode 为主", () => {
    const info = resolveManifestUpdate(manifest(), "0.1.8", 9);
    expect(info).toMatchObject({
      version: "0.1.9",
      versionCode: 10,
      apkUrl: "https://cdn.example.com/nibi-go-10.apk",
      urls: [
        "https://cdn.example.com/nibi-go-10.apk",
        "https://github.com/example/releases/download/v0.1.9/app.apk",
      ],
    });
    expect(resolveManifestUpdate(manifest(), "0.1.9", 10)).toBeNull();
    expect(resolveManifestUpdate(manifest(), "0.1.10", 11)).toBeNull();
  });

  it("开发环境 versionCode=0 时要求 semver 前进", () => {
    expect(resolveManifestUpdate(manifest(), "0.1.8", 0)).not.toBeNull();
    expect(resolveManifestUpdate(manifest(), "0.1.9", 0)).toBeNull();
  });
});
