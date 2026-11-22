import { describe, expect, it } from "vitest";

import { APP_CAPABILITIES, readPluginManifest } from "@nibi-go/plugin-contract";

import {
  friendlyApprovalTitle,
  friendlyToolName,
  friendlyToolTarget,
} from "../src/conversation/toolLabels";
import { BUNDLED_PLUGINS } from "../src/plugins/samples";

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
  it("包含文档四件套（Word/Excel/PPT/PDF）+ 可视化 + 写作与办公助手且清单全部合法", () => {
    const ids = BUNDLED_PLUGINS.map((item) => item.dir);
    expect(ids).toEqual([
      "nibigo-documents",
      "nibigo-spreadsheets",
      "nibigo-presentations",
      "nibigo-pdf",
      "nibigo-visualize",
      "nibigo-assistant",
    ]);

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
    }
  });
});
