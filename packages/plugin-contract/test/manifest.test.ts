import { describe, expect, it } from "vitest";

import {
  APP_CAPABILITIES,
  readPluginManifest,
  type HostProfile,
} from "../src";

const profile: HostProfile = {
  appVersion: "0.1.0",
  caps: APP_CAPABILITIES,
  host: "local",
};

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "nibigo.test",
    name: "测试插件",
    version: "0.1.0",
    minApp: "0.1.0",
    caps: ["view.v1", "slots.v1", "effects.v1"],
    contributes: {
      "composer.actions": [
        { id: "hello", title: "打个招呼", effects: [{ kind: "insert", text: "你好" }] },
      ],
      panels: [
        {
          id: "status",
          title: "状态",
          view: {
            type: "column",
            children: [{ type: "text", text: "插件状态正常" }],
          },
        },
      ],
    },
    ...overrides,
  };
}

describe("readPluginManifest", () => {
  it("接受一份合法清单并保留各槽", () => {
    const plugin = readPluginManifest(manifest(), profile);
    expect(plugin.status).toBe("ready");
    expect(plugin.slotsAvailable).toBe(true);
    expect(plugin.issues).toEqual([]);
    expect(plugin.manifest.contributes.composerActions).toHaveLength(1);
    expect(plugin.manifest.contributes.panels).toHaveLength(1);
  });

  it("忽略未知字段，不因此拒插件", () => {
    const plugin = readPluginManifest(
      manifest({ futureField: { anything: true } }),
      profile,
    );
    expect(plugin.status).toBe("ready");
  });

  it("顶层字段坏了整份 invalid，并给出 fallback id", () => {
    const plugin = readPluginManifest(
      { schemaVersion: 2, id: "Bad Id", name: "", version: "x" },
      profile,
      "weather",
    );
    expect(plugin.status).toBe("invalid");
    expect(plugin.manifest.id).toBe("weather");
    expect(plugin.slotsAvailable).toBe(false);
    expect(plugin.issues.length).toBeGreaterThan(0);
  });

  it("单条 contribution 坏了只丢这一条", () => {
    const plugin = readPluginManifest(
      manifest({
        contributes: {
          "composer.actions": [
            { id: "ok", title: "好的", effects: [{ kind: "insert", text: "行" }] },
            { id: "broken", title: "坏的", effects: [] },
          ],
          panels: [
            { id: "ok-panel", title: "正常", view: { type: "text", text: "ok" } },
            { id: "bad-panel", title: "坏的", view: "不是对象" },
          ],
        },
      }),
      profile,
    );
    expect(plugin.status).toBe("ready");
    expect(plugin.manifest.contributes.composerActions.map((action) => action.id)).toEqual(["ok"]);
    expect(plugin.manifest.contributes.panels.map((panel) => panel.id)).toEqual(["ok-panel"]);
    expect(plugin.issues.some((issue) => issue.path.includes("/composer.actions/1"))).toBe(true);
  });

  it("composer action 的文字上限是 10 字，最多 2 个", () => {
    const action = (id: string, title: string) => ({
      id,
      title,
      effects: [{ kind: "toast", text: "hi" }],
    });
    const plugin = readPluginManifest(
      manifest({
        contributes: {
          "composer.actions": [
            action("a", "一二三四五六七八九十"),
            action("b", "好的"),
            action("c", "多出来的"),
          ],
        },
      }),
      profile,
    );
    expect(plugin.manifest.contributes.composerActions.map((item) => item.id)).toEqual(["a", "b"]);
    expect(plugin.issues.some((issue) => issue.message.includes("最多 2 个"))).toBe(true);
  });

  it("minApp 高于当前 App 时 incompatible 且不渲染槽", () => {
    const plugin = readPluginManifest(manifest({ minApp: "9.0.0" }), profile);
    expect(plugin.status).toBe("incompatible");
    expect(plugin.reason).toContain("9.0.0");
    expect(plugin.slotsAvailable).toBe(false);
  });

  it("坏掉的 minApp 不当作兼容", () => {
    const plugin = readPluginManifest(manifest({ minApp: "latest" }), profile);
    expect(plugin.status).toBe("incompatible");
    expect(plugin.slotsAvailable).toBe(false);
  });

  it("远端主机降级为无槽，但插件仍可被发现", () => {
    const plugin = readPluginManifest(manifest(), { ...profile, host: "remote" });
    expect(plugin.status).toBe("ready");
    expect(plugin.reason).toContain("远端");
    expect(plugin.slotsAvailable).toBe(false);
  });

  it("用了 v2 tabs 的槽标记为已降级", () => {
    const plugin = readPluginManifest(
      manifest({
        contributes: {
          panels: [
            {
              id: "future",
              title: "未来",
              view: {
                type: "tabs",
                tabs: [{ label: "概览", children: [{ type: "text", text: "ok" }] }],
              },
            },
          ],
        },
      }),
      profile,
    );
    expect(plugin.status).toBe("ready");
    expect(plugin.degraded).toEqual(["panels:future"]);
  });

  it("解析剩余槽位并执行每插件上限", () => {
    const plugin = readPluginManifest(
      manifest({
        contributes: {
          "message.actions": [
            { id: "explain", title: "解释", effects: [{ kind: "insert", text: "解释一下" }] },
            { id: "shorten", title: "缩写", effects: [{ kind: "insert", text: "缩写" }] },
            { id: "polish", title: "润色", effects: [{ kind: "insert", text: "润色" }] },
            { id: "todos", title: "提炼待办", effects: [{ kind: "insert", text: "提炼待办" }] },
            { id: "extra", title: "多余", effects: [{ kind: "toast", text: "x" }] },
          ],
          "composer.tools": [
            {
              id: "template",
              title: "总结模板",
              icon: "sparkles",
              effects: [{ kind: "insert", text: "模板" }],
            },
            { id: "weekly", title: "周报", effects: [{ kind: "insert", text: "周报" }] },
            { id: "rfc", title: "方案", effects: [{ kind: "insert", text: "方案" }] },
            { id: "mail", title: "邮件", effects: [{ kind: "insert", text: "邮件" }] },
            { id: "overflow", title: "超限工具", effects: [{ kind: "toast", text: "y" }] },
          ],
          "session.actions": [
            { id: "status", title: "看状态", effects: [{ kind: "open", panel: "status" }] },
          ],
          "composer.strip": [{ id: "hint", text: "快捷动作可用" }],
          "turn.note": [{ id: "privacy", text: "本机 · 数据不出机" }],
        },
      }),
      profile,
    );
    expect(plugin.status).toBe("ready");
    expect(plugin.manifest.contributes.messageActions.map((action) => action.id)).toEqual([
      "explain",
      "shorten",
      "polish",
      "todos",
    ]);
    expect(plugin.manifest.contributes.composerTools.map((tool) => tool.id)).toEqual([
      "template",
      "weekly",
      "rfc",
      "mail",
    ]);
    expect(plugin.manifest.contributes.composerTools[0]).toMatchObject({
      id: "template",
      icon: "sparkles",
    });
    expect(plugin.manifest.contributes.sessionActions).toHaveLength(1);
    expect(plugin.manifest.contributes.strips).toHaveLength(1);
    expect(plugin.manifest.contributes.turnNotes).toHaveLength(1);
    expect(
      plugin.issues.some(
        (issue) =>
          issue.path === "/contributes/message.actions" && issue.message.includes("最多 4 个"),
      ),
    ).toBe(true);
    expect(
      plugin.issues.some(
        (issue) =>
          issue.path === "/contributes/composer.tools" && issue.message.includes("最多 4 个"),
      ),
    ).toBe(true);
  });

  it("状态条/脚注文字超长或缺失时丢掉该条", () => {
    const plugin = readPluginManifest(
      manifest({
        contributes: {
          "composer.strip": [{ id: "too-long", text: "字".repeat(121) }],
          "turn.note": [{ id: "missing" }],
        },
      }),
      profile,
    );
    expect(plugin.manifest.contributes.strips).toEqual([]);
    expect(plugin.manifest.contributes.turnNotes).toEqual([]);
    expect(plugin.issues.some((issue) => issue.path.includes("composer.strip"))).toBe(true);
    expect(plugin.issues.some((issue) => issue.path.includes("turn.note"))).toBe(true);
  });

  it("webIslands 只收 https 或内联 html，且二选一", () => {
    const plugin = readPluginManifest(
      manifest({
        contributes: {
          webIslands: [
            { id: "inline", title: "内联", html: "<html><body>ok</body></html>" },
            { id: "http", title: "明文", url: "http://example.com/panel" },
            { id: "remote", title: "远程", url: "https://example.com/panel" },
          ],
        },
      }),
      profile,
    );
    expect(plugin.manifest.contributes.webIslands.map((island) => island.id)).toEqual(["inline"]);
    // 一条 http 非法 + 一条超出上限。
    expect(plugin.issues.filter((issue) => issue.path.includes("webIslands"))).toHaveLength(2);
  });

  it("webIslands 拒绝 url+html 同时给和超长 html", () => {
    const plugin = readPluginManifest(
      manifest({
        contributes: {
          webIslands: [
            {
              id: "both",
              title: "两份",
              html: "<p>x</p>",
              url: "https://example.com",
            },
            { id: "large", title: "太大", html: "字".repeat(16 * 1024 + 1) },
          ],
        },
      }),
      profile,
    );
    expect(plugin.manifest.contributes.webIslands).toEqual([]);
    expect(plugin.issues.filter((issue) => issue.path.includes("webIslands"))).toHaveLength(2);
  });

  it("服务器名与 entry 做路径净化", () => {
    const plugin = readPluginManifest(
      manifest({
        runtime: { type: "mcp", serverName: "Bad-Name", entry: "../escape.mjs" },
      }),
      profile,
    );
    expect(plugin.manifest.runtime).toBeUndefined();
    expect(plugin.issues.some((issue) => issue.path === "/runtime")).toBe(true);
  });

  it("composer action 可以是命令/skill token，不需要 effects", () => {
    const plugin = readPluginManifest(
      manifest({
        contributes: {
          "composer.actions": [
            {
              id: "weather",
              title: "查天气",
              token: { kind: "command", value: "nibigo-weather-weather" },
              prompt: "查询天气。\n$ARGUMENTS",
              skills: ["nibigo-weather:forecast"],
            },
            { id: "noprompt", title: "无正文", token: { kind: "command", value: "x" } },
          ],
        },
      }),
      profile,
    );
    expect(plugin.status).toBe("ready");
    expect(plugin.manifest.contributes.composerActions).toHaveLength(1);
    expect(plugin.manifest.contributes.composerActions[0]).toMatchObject({
      id: "weather",
      token: { kind: "command", value: "nibigo-weather-weather" },
      skills: ["nibigo-weather:forecast"],
    });
    expect(plugin.issues.some((issue) => issue.path.includes("/composer.actions/1/prompt"))).toBe(
      true,
    );
  });

  it("message action 支持命令改写与旧 instruction 注释", () => {
    const plugin = readPluginManifest(
      manifest({
        contributes: {
          "message.actions": [
            {
              id: "polish",
              title: "润色",
              command: "nibigo-quick-polish-message",
              prompt: "只输出润色后的正文。",
              skills: ["nibigo-quick:writing-check"],
            },
            { id: "annotate", title: "注释", instruction: "把这条消息润色得更清楚。" },
          ],
        },
      }),
      profile,
    );
    expect(plugin.manifest.contributes.messageActions).toHaveLength(2);
    expect(plugin.manifest.contributes.messageActions[0]).toMatchObject({
      command: "nibigo-quick-polish-message",
      prompt: "只输出润色后的正文。",
      skills: ["nibigo-quick:writing-check"],
    });
    expect(plugin.manifest.contributes.messageActions[1]?.instruction).toContain("润色");
  });

  it("message action 的 command 缺 prompt 时只丢这一条", () => {
    const plugin = readPluginManifest(
      manifest({
        contributes: {
          "message.actions": [
            { id: "broken", title: "坏的", command: "nibigo-quick-x" },
            { id: "ok", title: "好的", instruction: "说明一下。" },
          ],
        },
      }),
      profile,
    );
    expect(plugin.manifest.contributes.messageActions.map((action) => action.id)).toEqual(["ok"]);
    expect(plugin.issues.some((issue) => issue.path.includes("/message.actions/0/prompt"))).toBe(
      true,
    );
  });

  it("插件级 skills 与 accent 会被保留", () => {
    const plugin = readPluginManifest(
      manifest({
        accent: "ok",
        skills: [
          {
            id: "writing-check",
            name: "写作检查",
            description: "检查事实、结构、语气、长度。",
            body: "# 写作检查\n\n先看事实。",
          },
        ],
      }),
      profile,
    );
    expect(plugin.manifest.accent).toBe("ok");
    expect(plugin.manifest.skills?.[0]?.id).toBe("writing-check");
  });

  it("settings：保留 text/toggle/select，坏项只丢该条", () => {
    const plugin = readPluginManifest(
      manifest({
        settings: [
          { id: "city", title: "默认城市", type: "text", default: "北京", maxLength: 20 },
          { id: "verbose", title: "详细输出", type: "toggle", default: true },
          {
            id: "mode",
            title: "模式",
            type: "select",
            options: [
              { value: "quick", label: "快速" },
              { value: "deep", label: "深入" },
            ],
          },
          { id: "Bad Id", title: "坏 id", type: "text" },
          { id: "empty", title: "空选择", type: "select", options: [] },
          { id: "weird", title: "未知类型", type: "slider" },
        ],
      }),
      profile,
    );
    expect(plugin.manifest.settings).toEqual([
      { id: "city", title: "默认城市", type: "text", default: "北京", maxLength: 20 },
      { id: "verbose", title: "详细输出", type: "toggle", default: true },
      {
        id: "mode",
        title: "模式",
        type: "select",
        default: "quick",
        options: [
          { value: "quick", label: "快速" },
          { value: "deep", label: "深入" },
        ],
      },
    ]);
    expect(plugin.issues.filter((issue) => issue.path.startsWith("/settings"))).toHaveLength(3);
  });

  it("settings 超过 8 项只保留前 8 项", () => {
    const plugin = readPluginManifest(
      manifest({
        settings: Array.from({ length: 10 }, (_, index) => ({
          id: `s${index}`,
          title: `设置 ${index}`,
          type: "toggle",
        })),
      }),
      profile,
    );
    expect(plugin.manifest.settings).toHaveLength(8);
    expect(plugin.issues.some((issue) => issue.path === "/settings")).toBe(true);
  });

  it("runtime 支持 args 与 envMap 并拒绝越界 entry 路径", () => {
    const ok = readPluginManifest(
      manifest({
        runtime: {
          type: "mcp",
          serverName: "amap_maps",
          entry: "node_modules/@amap/amap-maps-mcp-server/build/index.js",
          args: ["--stdio"],
          envMap: { api_key: "AMAP_MAPS_API_KEY" },
        },
      }),
      profile,
    );
    expect(ok.status).toBe("ready");
    expect(ok.manifest.runtime?.args).toEqual(["--stdio"]);
    expect(ok.manifest.runtime?.envMap).toEqual({ api_key: "AMAP_MAPS_API_KEY" });

    const bad = readPluginManifest(
      manifest({
        runtime: {
          type: "mcp",
          serverName: "bad_entry",
          entry: "../outside.js",
        },
      }),
      profile,
    );
    expect(bad.manifest.runtime).toBeUndefined();
    expect(bad.issues.some((issue) => issue.path === "/runtime")).toBe(true);
  });
});