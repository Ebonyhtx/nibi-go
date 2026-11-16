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
            { id: "extra", title: "多余", effects: [{ kind: "toast", text: "x" }] },
          ],
          "composer.tools": [
            {
              id: "template",
              title: "总结模板",
              icon: "sparkles",
              effects: [{ kind: "insert", text: "模板" }],
            },
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
    ]);
    expect(plugin.manifest.contributes.composerTools[0]).toMatchObject({
      id: "template",
      icon: "sparkles",
    });
    expect(plugin.manifest.contributes.sessionActions).toHaveLength(1);
    expect(plugin.manifest.contributes.strips).toHaveLength(1);
    expect(plugin.manifest.contributes.turnNotes).toHaveLength(1);
    expect(plugin.issues.some((issue) => issue.message.includes("最多 2 个"))).toBe(true);
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
});