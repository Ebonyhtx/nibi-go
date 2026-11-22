import { describe, expect, it, vi } from "vitest";

import { APP_CAPABILITIES, readPluginManifest } from "@nibi-go/plugin-contract";

import {
  buildNpmPluginManifest,
  classifyNpmHit,
  detectNpmEnvSpecs,
  extractEnvVarsFromDotEnv,
  extractEnvVarsFromJs,
  extractEnvVarsFromReadme,
  inferNpmPackageFromEntry,
  inspectNpmPackageJson,
  mcpServerNameFor,
  missingEnvVarNames,
  npmPluginIdFor,
  npmRegistriesForRegion,
  parseNpmSpec,
  PUBLIC_BROWSE_CHANNELS,
  resolvePluginMcpEnv,
  searchNpmPackages,
  validatePluginEnvName,
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

describe("npm MCP 环境变量自动探测与注入", () => {
  it("从 JS 源码提取 process.env.*（点号/下标/解构）并过滤系统与噪音变量", () => {
    const code = `
      const key = process.env.AMAP_KEY || process.env["AMAP_MAPS_API_KEY"];
      const tok = process?.env?.['GITHUB_TOKEN'];
      const { TAVILY_API_KEY, NODE_ENV = "production", DEBUG: dbg, LD_PRELOAD } = process.env;
      const ignored = [process.env.PATH, process.env.HOME, process.env.HTTP_PROXY, process.env.NPM_CONFIG_REGISTRY];
    `;
    expect(extractEnvVarsFromJs(code)).toEqual([
      "AMAP_KEY",
      "AMAP_MAPS_API_KEY",
      "GITHUB_TOKEN",
      "TAVILY_API_KEY",
    ]);
  });

  it("从 README 的 MCP env 配置片段与 .env.example 提取环境变量", () => {
    const readme = `
      # amap-mcp-server
      \`\`\`json
      {
        "mcpServers": {
          "amap": {
            "command": "npx",
            "args": ["-y", "amap-mcp-server"],
            "env": {
              "AMAP_KEY": "your-amap-web-service-key",
              "NODE_ENV": "production"
            }
          }
        }
      }
      \`\`\`
      export AMAP_SECURITY_CODE=abc
      YOUR_API_KEY=ignored
    `;
    expect(extractEnvVarsFromReadme(readme)).toEqual(["AMAP_KEY", "AMAP_SECURITY_CODE"]);
    expect(
      extractEnvVarsFromDotEnv("# comment\nAMAP_KEY=\nPORT=3000\nBRAVE_API_KEY=xxx\n"),
    ).toEqual(["AMAP_KEY", "BRAVE_API_KEY"]);
  });

  it("合并显式项与自动探测项生成零告警的宿主清单", () => {
    const specs = detectNpmEnvSpecs({
      jsFiles: ['const apiKey = process.env.AMAP_KEY || process.env.AMAP_MAPS_API_KEY;'],
      readmeFiles: ['"env": { "AMAP_KEY": "xxx", "AMAP_EXTRA_TOKEN": "yyy" }'],
    });
    expect(specs.map((item) => item.name)).toEqual([
      "AMAP_KEY",
      "AMAP_MAPS_API_KEY",
      "AMAP_EXTRA_TOKEN",
    ]);

    const { hostManifest } = buildNpmPluginManifest({
      id: "npm.amap-mcp-server",
      name: "amap-mcp-server",
      version: "1.2.1",
      packageName: "amap-mcp-server",
      pluginEntry: "node_modules/amap-mcp-server/index.js",
      env: specs,
    });
    const parsed = readPluginManifest(
      hostManifest,
      { host: "local", appVersion: "0.1.7", caps: APP_CAPABILITIES },
      "npm.amap-mcp-server",
    );
    expect(parsed.status).toBe("ready");
    expect(parsed.issues).toEqual([]);
    expect(parsed.manifest.runtime?.envMap).toEqual({
      amap_key: "AMAP_KEY",
      amap_maps_api_key: "AMAP_MAPS_API_KEY",
      amap_extra_token: "AMAP_EXTRA_TOKEN",
    });
  });

  it("校验自定义环境变量名并拦截高危系统变量", () => {
    expect(validatePluginEnvName("AMAP_KEY")).toEqual({ ok: true, name: "AMAP_KEY" });
    expect(validatePluginEnvName("  API_V2_KEY  ")).toEqual({ ok: true, name: "API_V2_KEY" });
    expect(validatePluginEnvName("amap_key").ok).toBe(false);
    expect(validatePluginEnvName("1_KEY").ok).toBe(false);
    expect(validatePluginEnvName("PATH").ok).toBe(false);
    expect(validatePluginEnvName("NODE_OPTIONS").ok).toBe(false);
    expect(validatePluginEnvName("LD_PRELOAD").ok).toBe(false);
    expect(validatePluginEnvName("NIBIGO_SETTINGS").ok).toBe(false);
  });

  it("合并 envMap 与 customEnv 注入 MCP 启动环境，并准确计算待配置变量", () => {
    const env = resolvePluginMcpEnv({
      settings: { amap_key: "from-settings", empty_key: "   " },
      envMap: { amap_key: "AMAP_KEY", empty_key: "EMPTY_KEY", bad: "PATH" },
      customEnv: {
        AMAP_KEY: "from-custom",
        EXTRA_TOKEN: "tok-123",
        NODE_OPTIONS: "--evil",
      },
    });
    expect(env).toEqual([
      { name: "NIBIGO_SETTINGS", value: JSON.stringify({ amap_key: "from-settings", empty_key: "   " }) },
      { name: "AMAP_KEY", value: "from-custom" },
      { name: "EXTRA_TOKEN", value: "tok-123" },
    ]);

    // 免重装场景：已安装老清单无 envMap，但 detectedEnvVars 探测到 AMAP_KEY
    expect(
      missingEnvVarNames({
        settings: {},
        customEnv: {},
        detectedEnvVars: ["AMAP_KEY", "AMAP_MAPS_API_KEY"],
      }),
    ).toEqual(["AMAP_KEY", "AMAP_MAPS_API_KEY"]);

    // 在自定义环境变量中补配 AMAP_KEY 后，AMAP_KEY 不再缺失
    expect(
      missingEnvVarNames({
        settings: {},
        customEnv: { AMAP_KEY: "my-web-key" },
        detectedEnvVars: ["AMAP_KEY", "AMAP_MAPS_API_KEY"],
      }),
    ).toEqual(["AMAP_MAPS_API_KEY"]);

    // 从 runtime.entry 反推 npm 包名（兼容历史已装包无 sourceMeta 的场景）
    expect(inferNpmPackageFromEntry("node_modules/amap-mcp-server/index.js")).toBe(
      "amap-mcp-server",
    );
    expect(
      inferNpmPackageFromEntry("node_modules/@amap/amap-maps-mcp-server/build/index.js"),
    ).toBe("@amap/amap-maps-mcp-server");
    expect(inferNpmPackageFromEntry("server.mjs")).toBeUndefined();
  });
});

describe("公开页浏览频道、手机适配分级与分页搜索", () => {
  it("区分手机可用 MCP、纯 SDK 库与桌面浏览器依赖包", () => {
    expect(
      classifyNpmHit({
        name: "amap-mcp-server",
        description: "高德地图 MCP Server",
      }),
    ).toEqual({ suitability: "recommended" });

    expect(
      classifyNpmHit({
        name: "@modelcontextprotocol/sdk",
        description: "TypeScript SDK for Model Context Protocol",
      }),
    ).toEqual({ suitability: "library" });

    expect(
      classifyNpmHit({
        name: "@modelcontextprotocol/server-memory",
        description: "Knowledge graph memory MCP server",
      }),
    ).toEqual({ suitability: "recommended" });

    expect(
      classifyNpmHit({
        name: "@playwright/mcp",
        description: "Playwright MCP server for browser automation",
      }),
    ).toMatchObject({
      suitability: "desktop-only",
      mobileHint: expect.stringContaining("桌面浏览器"),
    });

    expect(
      classifyNpmHit({
        name: "macos-mcp",
        description: "Control macOS via AppleScript",
      }),
    ).toMatchObject({
      suitability: "desktop-only",
      mobileHint: expect.stringContaining("桌面系统"),
    });
  });

  it("公开浏览频道不包含 npmmirror 失效的高级语法（keywords:/scope:）", () => {
    expect(PUBLIC_BROWSE_CHANNELS.length).toBeGreaterThanOrEqual(7);
    for (const ch of PUBLIC_BROWSE_CHANNELS) {
      if (ch.query) {
        expect(ch.query).not.toMatch(/keywords:|scope:/iu);
      }
    }
  });

  it("searchNpmPackages 支持 from 分页、过滤纯库并按 rawCount 正确计算 hasMore", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          total: 50,
          objects: [
            {
              package: {
                name: "@modelcontextprotocol/sdk",
                version: "1.0.0",
                description: "TypeScript SDK for MCP",
              },
            },
            {
              package: {
                name: "chrome-devtools-mcp",
                version: "1.2.0",
                description: "Chrome DevTools MCP server",
              },
            },
            {
              package: {
                name: "amap-mcp-server",
                version: "1.2.1",
                description: "AMap MCP server",
                keywords: ["mcp", "map"],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      const res = await searchNpmPackages("mcp-server", "cn", {
        size: 3,
        from: 10,
        filterLibraries: true,
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("from=10"),
        expect.anything(),
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        // 过滤掉了 sdk，且把手机可用的 amap-mcp-server 排在 desktop-only 之前
        expect(res.hits.map((h) => h.name)).toEqual(["amap-mcp-server", "chrome-devtools-mcp"]);
        expect(res.rawCount).toBe(3);
        expect(res.from).toBe(10);
        expect(res.total).toBe(50);
        expect(res.hasMore).toBe(true);
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
