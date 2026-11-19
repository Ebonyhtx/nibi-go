// 手机操控状态封装：订阅只跟开关的有效变化走，不因连接状态刷新而触发会话 resume。
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  let status = {
    available: true,
    a11y: { enabled: false, connected: false, canScreenshot: true },
    shell: { enabled: false, installed: true, running: true, wirelessDebugging: true, permission: "granted" },
  };
  let server: {
    name: string;
    type: "http";
    url: string;
    headers: Array<{ name: string; value: string }>;
    alwaysLoad: boolean;
  } | null = {
    name: "phone",
    type: "http",
    url: "http://127.0.0.1:4321/mcp",
    headers: [{ name: "Authorization", value: "Bearer test-token" }],
    alwaysLoad: true,
  };
  let generation = 1;
  return {
    get generation() {
      return generation;
    },
    set generation(next: number) {
      generation = next;
    },
    get status() {
      return status;
    },
    set status(next: typeof status) {
      status = next;
    },
    reset() {
      status = {
        available: true,
        a11y: { enabled: false, connected: false, canScreenshot: true },
        shell: { enabled: false, installed: true, running: true, wirelessDebugging: true, permission: "granted" },
      };
      server = {
        name: "phone",
        type: "http",
        url: "http://127.0.0.1:4321/mcp",
        headers: [{ name: "Authorization", value: "Bearer test-token" }],
        alwaysLoad: true,
      };
      generation = 1;
    },
    getServer: () => server,
    setServer: (next: typeof server) => {
      server = next;
    },
  };
});

vi.mock("nibi-phone", () => ({
  phoneStatus: vi.fn(() => native.status),
  setPhoneA11yEnabled: vi.fn((enabled: boolean) => {
    native.status = {
      ...native.status,
      a11y: { ...native.status.a11y, enabled },
    };
    return native.status;
  }),
  setPhoneShellEnabled: vi.fn((enabled: boolean) => {
    native.status = {
      ...native.status,
      shell: { ...native.status.shell, enabled },
    };
    return native.status;
  }),
  openPhoneAccessibilitySettings: vi.fn(),
  requestPhoneShellPermission: vi.fn(),
  openPhoneShellManager: vi.fn(),
  phoneMcpServer: vi.fn(() => native.getServer()),
  phoneMcpGeneration: vi.fn(() => native.generation),
}));

import {
  isPhoneToolsEnabled,
  phoneMcpServer,
  phoneStatus,
  phoneToolsRevision,
  setPhoneA11yEnabled,
  setPhoneShellEnabled,
  subscribePhoneToolsChanged,
} from "./status";

beforeEach(() => {
  native.reset();
});

describe("phone status", () => {
  it("透传原生状态；两个开关都关时不交给内核", () => {
    expect(phoneStatus().available).toBe(true);
    expect(isPhoneToolsEnabled()).toBe(false);
    expect(phoneMcpServer()).toBeNull();
  });

  it("任一开关打开且服务器可用时才返回 MCP 配置", () => {
    setPhoneA11yEnabled(true);
    expect(isPhoneToolsEnabled()).toBe(true);
    expect(phoneMcpServer()?.name).toBe("phone");
  });

  it("原生服务器缺失时为 null", () => {
    setPhoneA11yEnabled(true);
    native.setServer(null);
    expect(phoneMcpServer()).toBeNull();
  });

  it("服务器代次变化时通知，触发会话重新挂载", () => {
    setPhoneA11yEnabled(true);
    phoneMcpServer(); // 首次观察当前代次，不通知
    const listener = vi.fn();
    const unsubscribe = subscribePhoneToolsChanged(listener);
    const before = phoneToolsRevision();

    native.generation = 2;
    expect(phoneMcpServer()?.name).toBe("phone");

    expect(phoneToolsRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("服务器代次不变时不通知", () => {
    setPhoneA11yEnabled(true);
    phoneMcpServer();
    const listener = vi.fn();
    const unsubscribe = subscribePhoneToolsChanged(listener);
    const before = phoneToolsRevision();

    phoneMcpServer();

    expect(phoneToolsRevision()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("phone tools change", () => {
  it("开关打开时通知一次并递增 revision", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePhoneToolsChanged(listener);
    const before = phoneToolsRevision();

    expect(setPhoneA11yEnabled(true).a11y.enabled).toBe(true);
    expect(phoneToolsRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("重复写入相同开关值不通知", () => {
    native.status = {
      ...native.status,
      a11y: { enabled: true, connected: false, canScreenshot: true },
    };
    const listener = vi.fn();
    const unsubscribe = subscribePhoneToolsChanged(listener);
    const before = phoneToolsRevision();

    setPhoneA11yEnabled(true);

    expect(phoneToolsRevision()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("仅系统连接状态变化不通知", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePhoneToolsChanged(listener);
    const before = phoneToolsRevision();
    native.status = {
      ...native.status,
      a11y: { enabled: false, connected: true, canScreenshot: true },
    };

    // 开关值没变（仍是 false），即使原生状态里 connected 已变，也不需要重设 session。
    setPhoneA11yEnabled(false);

    expect(phoneToolsRevision()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("关闭最后一个打开的开关时再次通知", () => {
    setPhoneA11yEnabled(true);
    const listener = vi.fn();
    const unsubscribe = subscribePhoneToolsChanged(listener);
    const before = phoneToolsRevision();

    expect(setPhoneA11yEnabled(false).a11y.enabled).toBe(false);
    expect(phoneToolsRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(isPhoneToolsEnabled()).toBe(false);
    unsubscribe();
  });

  it("shell 开关独立触发通知", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePhoneToolsChanged(listener);
    const before = phoneToolsRevision();

    setPhoneShellEnabled(true);

    expect(phoneToolsRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(isPhoneToolsEnabled()).toBe(true);
    unsubscribe();
  });

  it("取消订阅后不再收到通知", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePhoneToolsChanged(listener);
    unsubscribe();

    setPhoneA11yEnabled(true);

    expect(listener).not.toHaveBeenCalled();
  });
});