// @nibi-go/phone-tools —— 手机工具面的纯 TS 接口层（D11/D13，AGENTS 规则 8）。
//
// 这里只定义"跨平台可见"的状态、开关与 MCP 服务器形状；Android 实现放在
// app/modules/nibi-phone（AccessibilityService + Shizuku + loopback MCP）。
// 接口层不得出现 Android 专属类型。

export const PACKAGE_NAME = "@nibi-go/phone-tools" as const;

/** Shizuku 授权状态；unknown 表示接口不可用或尚未探测。 */
export type PhonePermissionState = "granted" | "denied" | "unknown";

/** 开关 1：无障碍手机操控。 */
export interface PhoneA11yStatus {
  /** 用户在 App 内打开的总开关（不是系统无障碍开关）。 */
  enabled: boolean;
  /** 系统无障碍服务已连接。 */
  connected: boolean;
  /** 当前系统支持无障碍截屏（Android 11+）。 */
  canScreenshot: boolean;
}

/** 开关 2：Shizuku / 无线调试的高级手机操控。 */
export interface PhoneShellStatus {
  enabled: boolean;
  /** 设备上装了 Shizuku（或 Sui）。 */
  installed: boolean;
  /** Shizuku binder 存活（服务已启动）。 */
  running: boolean;
  /** 系统无线调试是否开启（Shizuku 可用它启动；配对在 Shizuku 内完成）。 */
  wirelessDebugging: boolean;
  permission: PhonePermissionState;
}

export interface PhoneStatus {
  /** 原生模块是否可用（Expo Go / 非 Android 上为 false）。 */
  available: boolean;
  a11y: PhoneA11yStatus;
  shell: PhoneShellStatus;
}

/** 交给内核的会话级 MCP 服务器（结构对齐 KernelMcpServer）。 */
export interface PhoneMcpServerConfig {
  name: string;
  type: "http";
  url: string;
  headers: Array<{ name: string; value: string }>;
  alwaysLoad: boolean;
}

/** 平台适配器由 app/modules/nibi-phone 实现。 */
export interface PhoneToolsAdapter {
  status(): PhoneStatus;
  setA11yEnabled(enabled: boolean): PhoneStatus;
  setShellEnabled(enabled: boolean): PhoneStatus;
  openAccessibilitySettings(): void;
  requestShellPermission(): void;
  openShellManager(): void;
  /** 原生 MCP 服务可用且至少一个开关打开时返回配置；否则 null。 */
  mcpServer(): PhoneMcpServerConfig | null;
}

export function unavailablePhoneStatus(): PhoneStatus {
  return {
    available: false,
    a11y: { enabled: false, connected: false, canScreenshot: false },
    shell: {
      enabled: false,
      installed: false,
      running: false,
      wirelessDebugging: false,
      permission: "unknown",
    },
  };
}

/** 至少一个开关打开才把手机 MCP 服务器交给内核。 */
export function phoneToolsEnabled(status: PhoneStatus): boolean {
  return status.available && (status.a11y.enabled || status.shell.enabled);
}

/** 会话建立/恢复时取 phone MCP 配置；开关全关或模块不可用时为 null。 */
export function phoneMcpServerFor(
  status: PhoneStatus,
  adapter: Pick<PhoneToolsAdapter, "mcpServer">,
): PhoneMcpServerConfig | null {
  if (!phoneToolsEnabled(status)) return null;
  return adapter.mcpServer();
}

/** 能力摘要，用于设置页与 MCP instructions；纯函数便于测试。 */
export function describePhoneCapabilities(status: PhoneStatus): string[] {
  if (!status.available) return ["不可用"];
  const items: string[] = [];
  if (status.a11y.connected) items.push("读屏");
  if (status.a11y.connected) items.push("点按/输入");
  if (status.a11y.connected && status.a11y.canScreenshot) items.push("截屏");
  if (status.shell.enabled && status.shell.permission === "granted" && status.shell.running) {
    items.push("shell");
  }
  return items.length > 0 ? items : ["未开启"];
}