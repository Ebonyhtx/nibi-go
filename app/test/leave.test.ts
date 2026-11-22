// 离屏导航收起输入法的回归测试。
//
// 复发点：抽屉（侧栏）里先 Keyboard.dismiss() 再 blur，输入框仍有焦点，Android 在
// 转场时会把输入法再弹一下。顺序必须是 blur → dismiss → navigate。
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  dismissKeyboardOnFocus,
  leaveComposerForNavigation,
} from "../src/composer/leave";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("leaveComposerForNavigation", () => {
  it("先 blur 再 dismiss，最后导航", () => {
    const calls: string[] = [];
    leaveComposerForNavigation({
      blur: () => calls.push("blur"),
      dismiss: () => calls.push("dismiss"),
      navigate: () => calls.push("navigate"),
    });
    expect(calls).toEqual(["blur", "dismiss", "navigate"]);
  });

  it("没有输入框时仍收键盘并导航", () => {
    const dismiss = vi.fn();
    const navigate = vi.fn();
    leaveComposerForNavigation({ dismiss, navigate });
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("blur 抛错不影响收键盘与导航", () => {
    const dismiss = vi.fn();
    const navigate = vi.fn();
    leaveComposerForNavigation({
      blur: () => {
        throw new Error("input already unmounted");
      },
      dismiss,
      navigate,
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("dismiss 抛错仍然导航", () => {
    const navigate = vi.fn();
    leaveComposerForNavigation({
      dismiss: () => {
        throw new Error("ime detached");
      },
      navigate,
    });
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe("dismissKeyboardOnFocus", () => {
  it("调用 dismiss，异常不外抛", () => {
    const dismiss = vi.fn();
    dismissKeyboardOnFocus(dismiss);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(() =>
      dismissKeyboardOnFocus(() => {
        throw new Error("no ime");
      }),
    ).not.toThrow();
  });
});

describe("入口接线（防回归）", () => {
  it("抽屉的设置/插件入口走统一 helper，且不再出现 dismiss→blur 的旧顺序", () => {
    const drawer = source("src/components/GoDrawer.tsx");
    expect(drawer).toContain("leaveComposerForNavigation({");
    expect(drawer).toContain('leaveFor("/settings")');
    expect(drawer).toContain('leaveFor("/plugins")');
    expect(drawer).not.toMatch(/Keyboard\.dismiss\(\);\s*onBeforeNavigate\?\.\(\)/);
    // 抽屉搜索框会被系统自动聚焦；导航前必须 blur 它，否则输入法会闪。
    expect(drawer).toContain("ref={searchRef}");
    expect(drawer).toContain("searchRef.current?.blur()");
    // 展开侧栏（GoSidebar）与抽屉共用同一份导航内容，也必须把 blur 透传下去。
    expect(drawer).toContain("onBeforeNavigate={onBeforeNavigate}");
  });

  it("抽屉搜索框点击才激活（未激活不渲染 TextInput，系统无从自动聚焦）", () => {
    const drawer = source("src/components/GoDrawer.tsx");
    // 新不变量（2026-11-22 真机复盘）：搜索框默认渲染成占位行，点击后才挂 TextInput；
    // 「抽屉一开就自动聚焦搜索框」正是键盘闪现的复发点，不能靠事后 blur 补。
    expect(drawer).toContain("searchArmed");
    expect(drawer).toContain("setSearchArmed(true)");
    expect(drawer).toContain("搜索对话</Text>");
    // leaveFor 必须把两处焦点都清掉：首页输入框（由父级传下来的 onBeforeNavigate）
    // 和抽屉自己的搜索框。只清一处都不够——这正是之前复发的形态。
    const leaveFor = drawer.slice(drawer.indexOf("const leaveFor"), drawer.indexOf("// 会话列表"));
    expect(leaveFor).toContain("onBeforeNavigate?.()");
    expect(leaveFor).toContain("searchRef.current?.blur()");
    expect(leaveFor.indexOf("onBeforeNavigate?.()")).toBeLessThan(
      leaveFor.indexOf("searchRef.current?.blur()"),
    );
    // dismiss 必须走可见性守卫：百度输入法对「已收起时的再次 dismiss」会反转弹出。
    expect(leaveFor).toContain("dismissKeyboardOnce");
  });

  it("抽屉关掉时清搜索焦点、复位激活态，且不再重复 dismiss（双重 dismiss 会反转弹出）", () => {
    const drawer = source("src/components/GoDrawer.tsx");
    expect(drawer).toContain("active={open}");
    expect(drawer).toMatch(
      /if \(wasActive\.current && !active\) \{[\s\S]*?searchRef\.current\?\.blur\(\);[\s\S]*?setSearchArmed\(false\);[\s\S]*?\}/,
    );
    const closeEffect = drawer.slice(
      drawer.indexOf("if (wasActive.current && !active)"),
      drawer.indexOf("if (!wasActive.current && active)"),
    );
    expect(closeEffect).not.toMatch(/Keyboard\.dismiss\(\);/);
  });

  it("首屏 rail 的设置/插件入口走统一 helper", () => {
    const home = source("src/app/index.tsx");
    expect(home).toContain("leaveComposerForNavigation({");
    expect(home).toContain('router.push("/settings")');
    expect(home).toContain('router.push("/plugins")');
  });

  it("开抽屉/展开侧栏前也先清掉输入框焦点（聚焦守卫版 blurComposer）", () => {
    const home = source("src/app/index.tsx");
    // 顶栏 onMenu 的开抽屉分支必须走 helper；展开侧栏分支至少显式 blur。
    // blur 统一走 blurComposer：只在输入框真正聚焦时调用——对未聚焦 EditText
    // 调 blur() 会反向触发一次 IME 弹出。
    expect(home).toMatch(/onMenu = \(\) => \{[\s\S]*?leaveComposerForNavigation/);
    expect(home).toContain("blurComposer();");
    expect(home).toMatch(/setSidebarOpen\(true\)/);
    expect(home).toContain("composerFocusedRef");
    // 离屏导航窗口期锁死 composer（editable=false 让 IME 失去 served view）。
    expect(home).toContain("composerLocked");
    expect(home).toContain("editable={conversation.ready && !composerLocked}");
  });

  it("设置页 focus 时仍明确收键盘", () => {
    const settings = source("src/app/settings/index.tsx");
    expect(settings).toContain("dismissKeyboardOnFocus(Keyboard.dismiss)");
  });
});
