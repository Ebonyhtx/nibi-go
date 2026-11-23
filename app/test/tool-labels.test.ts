import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_CAPABILITIES, readPluginManifest } from "@nibi-go/plugin-contract";

import {
  friendlyApprovalTitle,
  friendlyToolName,
  friendlyToolTarget,
} from "../src/conversation/toolLabels";
import { resetLanguagePreferencesForTest, setLanguageMode } from "../src/i18n";
import { BUNDLED_PLUGINS, RETIRED_SAMPLE_DIRS } from "../src/plugins/samples";

beforeEach(async () => {
  await setLanguageMode("zh-CN");
});

afterEach(() => {
  resetLanguagePreferencesForTest();
});

describe("toolLabels 用户口径中文化", () => {
  it("将 mcp__phone__* 工具名映射为自然中文动作", () => {
    expect(friendlyToolName("mcp__phone__list_apps")).toBe("查看手机应用");
    expect(friendlyToolName("mcp__phone__open_app", '{"package":"com.tencent.mm"}')).toBe(
      "打开手机应用",
    );
    expect(friendlyToolName("mcp__phone__open_app", '{"url":"https://nibistudio.cn"}')).toBe(
      "在手机打开网页",
    );
    expect(friendlyToolName("mcp__phone__screen_tree")).toBe("读取手机屏幕");
    expect(friendlyToolName("mcp__phone__click", '{"nodeId":3}')).toBe("点按手机屏幕");
    expect(friendlyToolName("mcp__phone__click", '{"nodeId":3,"long":true}')).toBe("长按手机屏幕");
    expect(friendlyToolName("mcp__phone__type_text", '{"text":"你好"}')).toBe("在手机输入文字");
    expect(friendlyToolName("mcp__phone__swipe")).toBe("滑动手机屏幕");
    expect(friendlyToolName("mcp__phone__press_key")).toBe("按下手机按键");
    expect(friendlyToolName("mcp__phone__screenshot")).toBe("截取手机屏幕");
    expect(friendlyToolName("mcp__phone__shell")).toBe("执行手机系统命令");
  });

  it("将内置与文档套件 MCP 工具名映射为中文，且摘要不泄漏原始 JSON", () => {
    expect(friendlyToolName("Bash")).toBe("运行终端命令");
    expect(friendlyToolName("Read")).toBe("读取文件");
    expect(friendlyToolName("Write")).toBe("写入文件");
    expect(friendlyToolName("Edit")).toBe("修改文件");
    expect(friendlyToolName("mcp__nibigo-documents__create_docx")).toBe("生成 Word 文档");
    expect(friendlyToolName("mcp__nibigo-spreadsheets__create_xlsx")).toBe("生成 Excel 表格");
    expect(friendlyToolName("mcp__nibigo-presentations__create_pptx")).toBe("生成 PPT 演示文稿");
    expect(friendlyToolName("mcp__nibigo-pdf__create_pdf")).toBe("生成 PDF 文档");

    expect(
      friendlyToolTarget("mcp__phone__press_key", '{"key":"home"}'),
    ).toBe("主屏幕键");
    expect(
      friendlyToolTarget("mcp__nibigo-documents__create_docx", '{"filename":"报告.docx","title":"季度总结"}'),
    ).toBe("季度总结 (报告.docx)");
  });

  it("审批标题使用用户易懂的中文询问句", () => {
    expect(friendlyApprovalTitle("mcp__phone__tap")).toBe("允许点按手机屏幕上的元素？");
    expect(friendlyApprovalTitle("mcp__phone__click")).toBe("允许点按手机屏幕上的元素？");
    expect(friendlyApprovalTitle("Bash")).toBe("允许运行这条终端命令？");
  });
});

describe("BUNDLED_PLUGINS 内置插件套件校验", () => {
  it("包含文档四件套（Word/Excel/PPT/PDF）+ 可视化 + 指南且清单零告警", () => {
    const ids = BUNDLED_PLUGINS.map((item) => item.dir);
    expect(ids).toEqual([
      "nibigo-documents",
      "nibigo-spreadsheets",
      "nibigo-presentations",
      "nibigo-pdf",
      "nibigo-visualize",
      "nibigo-guide",
    ]);
    expect(RETIRED_SAMPLE_DIRS).toContain("nibigo-assistant");

    for (const plugin of BUNDLED_PLUGINS) {
      const parsed = readPluginManifest(
        plugin.manifest,
        {
          host: "local",
          appVersion: "0.1.7",
          caps: APP_CAPABILITIES,
        },
        plugin.dir,
      );
      expect(parsed.status).toBe("ready");
      expect(parsed.issues).toEqual([]);
      expect(parsed.degraded).toEqual([]);
    }
  });
});

describe("context.window 插件槽", () => {
  it("解析视图/动作，并按每插件 2 条上限截断", () => {
    const parsed = readPluginManifest(
      {
        schemaVersion: 1,
        id: "ctx-demo",
        name: "上下文示例",
        version: "1.0.0",
        contributes: {
          "context.window": [
            { id: "one", title: "缓存", view: { type: "text", text: "命中 98%" } },
            {
              id: "two",
              view: {
                type: "column",
                children: [{ type: "text", text: "工具预算" }],
              },
              actions: [
                {
                  id: "open",
                  label: "打开",
                  effects: [{ kind: "open", panel: "handbook" }],
                },
              ],
            },
            { id: "three", view: { type: "text", text: "超出上限" } },
          ],
        },
      },
      { host: "local", appVersion: "0.1.8", caps: APP_CAPABILITIES },
      "ctx-demo",
    );

    expect(parsed.status).toBe("ready");
    expect(parsed.manifest.contributes.contextWindow).toHaveLength(2);
    expect(parsed.manifest.contributes.contextWindow[0]?.title).toBe("缓存");
    expect(parsed.manifest.contributes.contextWindow[1]?.actions[0]?.id).toBe("open");
    expect(parsed.issues.some((issue) => issue.path === "/contributes/context.window")).toBe(true);
    expect(parsed.degraded).toEqual([]);
  });
});
