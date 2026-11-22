import { describe, expect, it } from "vitest";

import {
  buildNpmPluginManifest,
  inspectNpmPackageJson,
  mcpServerNameFor,
  npmPluginIdFor,
  npmRegistriesForRegion,
  parseNpmSpec,
} from "../src/plugins/npmRegistry";

describe("parseNpmSpec", () => {
  it("解析普通包名、scoped 包名、精确版本与 npmjs 网页链接", () => {
    expect(parseNpmSpec("@modelcontextprotocol/server-sequential-thinking")).toEqual({
      ok: true,
      name: "@modelcontextprotocol/server-sequential-thinking",
    });
    expect(parseNpmSpec("@modelcontextprotocol/server-sequential-thinking@2.2.0")).toEqual({
      ok: true,
      name: "@modelcontextprotocol/server-sequential-thinking",
      version: "2.2.0",
    });
    expect(parseNpmSpec("mcp-server-demo@latest")).toEqual({
      ok: true,
      name: "mcp-server-demo",
    });
    expect(
      parseNpmSpec("https://www.npmjs.com/package/@modelcontextprotocol/server-memory/v/0.6.3"),
    ).toEqual({
      ok: true,
      name: "@modelcontextprotocol/server-memory",
      version: "0.6.3",
    });
    expect(parseNpmSpec("npx -y @amap/amap-maps-mcp-server")).toEqual({
      ok: true,
      name: "@amap/amap-maps-mcp-server",
    });
  });

  it("拒绝非法包名与版本范围符号", () => {
    expect(parseNpmSpec("")).toMatchObject({ ok: false });
    expect(parseNpmSpec("../evil")).toMatchObject({ ok: false });
    expect(parseNpmSpec("demo@^1.0.0")).toMatchObject({ ok: false });
    expect(parseNpmSpec("demo@~2.0.0")).toMatchObject({ ok: false });
  });
});

describe("npmPluginIdFor & mcpServerNameFor", () => {
  it("生成合法的插件 ID 与 MCP 服务器名", () => {
    expect(npmPluginIdFor("@modelcontextprotocol/server-sequential-thinking")).toBe(
      "npm.modelcontextprotocol.server-sequential-thinking",
    );
    expect(mcpServerNameFor("@modelcontextprotocol/server-sequential-thinking")).toBe(
      "sequential_thinking",
    );
    expect(mcpServerNameFor("@amap/amap-maps-mcp-server")).toBe("amap_maps_mcp_server");
    expect(mcpServerNameFor("123-tool")).toBe("mcp_123_tool");
  });

  it("国内源与国外源镜像顺序正确", () => {
    expect(npmRegistriesForRegion("cn")).toEqual([
      "https://registry.npmmirror.com",
      "https://registry.npmjs.org",
    ]);
    expect(npmRegistriesForRegion("global")).toEqual([
      "https://registry.npmjs.org",
      "https://registry.npmmirror.com",
    ]);
  });
});

describe("inspectNpmPackageJson", () => {
  it("解析纯 JS MCP 包的 bin 入口", () => {
    const result = inspectNpmPackageJson(
      {
        name: "@modelcontextprotocol/server-sequential-thinking",
        bin: { "mcp-server-sequential-thinking": "./dist/index.js" },
      },
      { packageName: "@modelcontextprotocol/server-sequential-thinking", strictInstallScripts: true },
    );
    expect(result).toEqual({
      ok: true,
      relativeEntry: "dist/index.js",
      pluginEntry: "node_modules/@modelcontextprotocol/server-sequential-thinking/dist/index.js",
      warnings: [],
    });
  });

  it("拦截非 Linux 系统、node-gyp 与市场严格模式下的 postinstall", () => {
    expect(
      inspectNpmPackageJson(
        { os: ["darwin"], bin: "index.js" },
        { packageName: "mac-only" },
      ),
    ).toMatchObject({ ok: false });

    expect(
      inspectNpmPackageJson(
        { scripts: { install: "node-gyp rebuild" }, bin: "index.js" },
        { packageName: "native-pkg" },
      ),
    ).toMatchObject({ ok: false });

    expect(
      inspectNpmPackageJson(
        { scripts: { postinstall: "node banner.js" }, bin: "index.js" },
        { packageName: "banner-pkg", strictInstallScripts: true },
      ),
    ).toMatchObject({ ok: false });

    // 个人安装模式允许无原生编译的 postinstall（实际安装时会用 --ignore-scripts 跳过），并附带提示
    const personal = inspectNpmPackageJson(
      { scripts: { postinstall: "node banner.js" }, bin: "index.js" },
      { packageName: "banner-pkg", strictInstallScripts: false },
    );
    expect(personal.ok).toBe(true);
    if (personal.ok) expect(personal.warnings).toHaveLength(1);
  });

  it("生成带 args 与 envMap 的宿主与内核清单", () => {
    const { hostManifest, kernelManifest } = buildNpmPluginManifest({
      id: "npm.amap.maps",
      name: "高德地图 MCP",
      version: "1.0.0",
      description: "路线规划与地理编码",
      packageName: "@amap/amap-maps-mcp-server",
      pluginEntry: "node_modules/@amap/amap-maps-mcp-server/build/index.js",
      args: ["--stdio"],
      env: [{ name: "AMAP_MAPS_API_KEY", title: "高德 API Key", required: true }],
    });
    expect(hostManifest).toMatchObject({
      schemaVersion: 1,
      id: "npm.amap.maps",
      runtime: {
        type: "mcp",
        entry: "node_modules/@amap/amap-maps-mcp-server/build/index.js",
        args: ["--stdio"],
        envMap: { amap_maps_api_key: "AMAP_MAPS_API_KEY" },
      },
    });
    expect(kernelManifest).toMatchObject({ name: "npm.amap.maps" });
  });
});
