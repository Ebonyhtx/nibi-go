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
    expect(drawer).toContain('router.push("/settings")');
    expect(drawer).toContain('router.push("/plugins")');
    expect(drawer).not.toMatch(/Keyboard\.dismiss\(\);\s*onBeforeNavigate\?\.\(\)/);
  });

  it("首屏 rail 的设置/插件入口走统一 helper", () => {
    const home = source("src/app/index.tsx");
    expect(home).toContain("leaveComposerForNavigation({");
    expect(home).toContain('router.push("/settings")');
    expect(home).toContain('router.push("/plugins")');
  });

  it("设置页 focus 时仍明确收键盘", () => {
    const settings = source("src/app/settings/index.tsx");
    expect(settings).toContain("dismissKeyboardOnFocus(Keyboard.dismiss)");
  });
});
