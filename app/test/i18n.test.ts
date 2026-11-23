import { describe, expect, it } from "vitest";

import {
  formatText,
  getCurrentLocale,
  normalizeLanguagePreferences,
  normalizeSystemLocale,
  pickText,
  resetLanguagePreferencesForTest,
  resolveLocale,
  saveLanguagePreferences,
  setLanguageMode,
} from "../src/i18n";
import {
  pluginActionTitle,
  pluginDisplayDescription,
  pluginDisplayName,
  pluginSkillName,
} from "../src/plugins/builtinI18n";

describe("i18n preferences & locale resolution", () => {
  it("normalizes system locales into zh-CN or en-US", () => {
    expect(normalizeSystemLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeSystemLocale("zh_Hans_CN")).toBe("zh-CN");
    expect(normalizeSystemLocale("zh-TW")).toBe("zh-CN");
    expect(normalizeSystemLocale("en-US")).toBe("en-US");
    expect(normalizeSystemLocale("en_GB")).toBe("en-US");
    expect(normalizeSystemLocale("ja-JP")).toBe("en-US");
    expect(normalizeSystemLocale("")).toBe("zh-CN");
  });

  it("resolves explicit overrides and falls back to system locale", () => {
    expect(resolveLocale("en-US", "zh-CN")).toBe("en-US");
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
    expect(resolveLocale("system", "en-US")).toBe("en-US");
    expect(resolveLocale("system", "zh-CN")).toBe("zh-CN");
  });

  it("normalizes invalid persisted payloads cleanly", () => {
    expect(normalizeLanguagePreferences(null)).toEqual({ version: 1, mode: "system" });
    expect(normalizeLanguagePreferences({ mode: "fr-FR" })).toEqual({ version: 1, mode: "system" });
    expect(normalizeLanguagePreferences({ mode: "en-US" })).toEqual({ version: 1, mode: "en-US" });
  });

  it("updates live locale cache via setLanguageMode and picks matching copy", async () => {
    resetLanguagePreferencesForTest();
    await setLanguageMode("en-US");
    expect(getCurrentLocale()).toBe("en-US");
    expect(pickText("设置", "Settings")).toBe("Settings");

    await saveLanguagePreferences({ version: 1, mode: "zh-CN" });
    expect(getCurrentLocale()).toBe("zh-CN");
    expect(pickText("设置", "Settings")).toBe("设置");
    expect(formatText("共 {n} 项", { n: 5 })).toBe("共 5 项");
    resetLanguagePreferencesForTest();
  });

  it("localizes built-in plugin display names, actions, and skills on live locale switch", async () => {
    resetLanguagePreferencesForTest();
    await setLanguageMode("zh-CN");
    expect(pluginDisplayName("nibigo-documents", "Word 文档")).toBe("Word 文档");
    expect(pluginActionTitle("nibigo-visualize", "make-chart", "画图表")).toBe("画图表");
    expect(pluginSkillName("nibigo-pdf", "pdf-publishing", "PDF 文档生成与解析")).toBe(
      "PDF 文档生成与解析",
    );

    await setLanguageMode("en-US");
    expect(pluginDisplayName("nibigo-documents", "Word 文档")).toBe("Word Documents");
    expect(pluginDisplayDescription("nibigo-documents", "中文描述")).toContain("Word (.docx)");
    expect(pluginActionTitle("nibigo-visualize", "make-chart", "画图表")).toBe("Draw Chart");
    expect(pluginSkillName("nibigo-pdf", "pdf-publishing", "PDF 文档生成与解析")).toBe(
      "PDF Authoring & Inspection",
    );
    expect(pluginDisplayName("custom.user-plugin", "My Plugin")).toBe("My Plugin");
    resetLanguagePreferencesForTest();
  });
});
