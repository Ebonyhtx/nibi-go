// nibi-phone —— 手机操控（Phase 5）的 Expo 原生模块桥。
//
// 原生实现放在 android/src/main/java/expo/modules/nibiphone：
// - NibiA11yService：无障碍读屏/手势/截屏；
// - McpHttpServer：127.0.0.1 上的会话级 MCP 服务器；
// - ShizukuShell：开关 2 的 shell uid 执行。
//
// 与其它本地模块同一纪律：模块缺失时导入不抛异常，状态降级为不可用。

import { requireNativeModule } from "expo-modules-core";

import {
  unavailablePhoneStatus,
  type PhoneMcpServerConfig,
  type PhoneStatus,
  type PhoneToolsAdapter,
} from "@nibi-go/phone-tools";

export interface PhoneApprovalRequest {
  interactionId: string;
  toolName: string;
  summary: string;
  detail: string;
  allowOptionId: string;
  /** 内核 allowAlways（按工具记住规则）；没有这个选项时为 null。 */
  alwaysOptionId?: string | null;
  denyOptionId: string;
}

export interface PhoneApprovalDecision {
  interactionId: string;
  optionId: string;
}

export type PhoneHapticKind = "tick" | "tap" | "threshold" | "confirm" | "reject" | "longPress";

interface NativePhoneModule {
  status(): PhoneStatus;
  setA11yEnabled(enabled: boolean): PhoneStatus;
  setShellEnabled(enabled: boolean): PhoneStatus;
  openAccessibilitySettings(): void;
  requestShellPermission(): void;
  openShellManager(): void;
  mcpServer(): PhoneMcpServerConfig | null;
  mcpGeneration(): number;
  showApproval(request: PhoneApprovalRequest): Promise<boolean>;
  hideApproval(interactionId?: string | null): Promise<void>;
  canShowApproval(): boolean;
  openOverlaySettings(): boolean;
  openAppSettings(): boolean;
  canShowBubble(): boolean;
  setBubbleState(state: string, scheme?: string | null): Promise<void>;
  toolsBusy(): boolean;
  haptic(kind: PhoneHapticKind): boolean;
  addListener(
    event: "onPhoneApproval",
    listener: (event: PhoneApprovalDecision) => void,
  ): { remove(): void };
}

let native: NativePhoneModule | null = null;
let loadError: string | null = null;
try {
  native = requireNativeModule<NativePhoneModule>("NibiPhone");
} catch (error) {
  loadError = error instanceof Error ? error.message : String(error);
}

export function phoneModuleAvailable(): boolean {
  return native !== null;
}

export function phoneModuleLoadError(): string | null {
  return loadError;
}

function call<T>(operation: (module: NativePhoneModule) => T, fallback: T): T {
  if (!native) return fallback;
  try {
    return operation(native);
  } catch (error) {
    console.warn("[nibigo] 手机操控原生调用失败", error);
    return fallback;
  }
}

export function phoneStatus(): PhoneStatus {
  const value = call((module) => module.status(), unavailablePhoneStatus());
  return normalizeStatus(value);
}

/** Expo 的 Map 嵌套值在类型上是 unknown，这里按契约收窄；坏形状一律降级。 */
function normalizeStatus(value: PhoneStatus): PhoneStatus {
  if (!value || typeof value !== "object" || value.available !== true) {
    return unavailablePhoneStatus();
  }
  const a11y = value.a11y;
  const shell = value.shell;
  if (!a11y || !shell) return unavailablePhoneStatus();
  return {
    available: true,
    a11y: {
      enabled: a11y.enabled === true,
      connected: a11y.connected === true,
      canScreenshot: a11y.canScreenshot === true,
    },
    shell: {
      enabled: shell.enabled === true,
      installed: shell.installed === true,
      running: shell.running === true,
      wirelessDebugging: shell.wirelessDebugging === true,
      permission:
        shell.permission === "granted" || shell.permission === "denied"
          ? shell.permission
          : "unknown",
    },
  };
}

export function setPhoneA11yEnabled(enabled: boolean): PhoneStatus {
  return normalizeStatus(
    call((module) => module.setA11yEnabled(enabled), unavailablePhoneStatus()),
  );
}

export function setPhoneShellEnabled(enabled: boolean): PhoneStatus {
  return normalizeStatus(
    call((module) => module.setShellEnabled(enabled), unavailablePhoneStatus()),
  );
}

export function openPhoneAccessibilitySettings(): void {
  call((module) => module.openAccessibilitySettings(), undefined);
}

export function requestPhoneShellPermission(): void {
  call((module) => module.requestShellPermission(), undefined);
}

export function openPhoneShellManager(): void {
  call((module) => module.openShellManager(), undefined);
}

export function phoneMcpServer(): PhoneMcpServerConfig | null {
  const value = call((module) => module.mcpServer(), null);
  if (!value || value.type !== "http" || typeof value.url !== "string") return null;
  return {
    name: typeof value.name === "string" ? value.name : "phone",
    type: "http",
    url: value.url,
    headers: Array.isArray(value.headers)
      ? value.headers
          .filter(
            (header) =>
              header && typeof header.name === "string" && typeof header.value === "string",
          )
          .map((header) => ({ name: header.name, value: header.value }))
      : [],
    alwaysLoad: value.alwaysLoad !== false,
  };
}

/** loopback MCP 服务器代次；每次启动/关闭都会变。 */
export function phoneMcpGeneration(): number {
  return call((module) => module.mcpGeneration(), 0);
}

/** 悬浮审批是否可用（系统「显示在其他应用上层」已授权）。 */
export function canShowPhoneApproval(): boolean {
  return call((module) => module.canShowApproval(), false);
}

/** 显示悬浮审批卡；返回 false 时调用方应保留应用内审批卡。 */
export async function showPhoneApproval(request: PhoneApprovalRequest): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.showApproval(request);
  } catch (error) {
    console.warn("[nibigo] 悬浮审批显示失败", error);
    return false;
  }
}

export function hidePhoneApproval(interactionId?: string | null): void {
  void native?.hideApproval(interactionId).catch(() => undefined);
}

export function openPhoneOverlaySettings(): void {
  call((module) => module.openOverlaySettings(), false);
}

/** 打开本应用信息页：ColorOS 的「后台弹出界面」等权限在这里。 */
export function openPhoneAppSettings(): void {
  call((module) => module.openAppSettings(), false);
}

/** 悬浮状态气泡权限（与审批悬浮卡同一条「显示在其他应用上层」）。 */
export function canShowPhoneBubble(): boolean {
  return call((module) => module.canShowBubble(), false);
}

/** 驱动悬浮像素宠物气泡；失败只记日志（气泡是提醒，不是关键路径）。 */
export function setPhoneBubbleState(state: string, scheme?: "light" | "dark" | "system"): void {
  void native?.setBubbleState(state, scheme ?? "system").catch((error) => {
    console.warn("[nibigo] 悬浮气泡状态设置失败", error);
  });
}

/** 原生侧当前是否有手机工具在执行（气泡 tools 状态的信号源）。 */
export function phoneToolsBusy(): boolean {
  return call((module) => module.toolsBusy(), false);
}

/** 触发一次 Android 原生线性马达触觉（模块不可用时静默降级）。 */
export function triggerPhoneHaptic(kind: PhoneHapticKind): void {
  if (!native) return;
  try {
    native.haptic(kind);
  } catch {
    // 触觉是非关键体验层，不打断交互。
  }
}

export function onPhoneApproval(
  listener: (event: PhoneApprovalDecision) => void,
): () => void {
  if (!native) return () => undefined;
  const subscription = native.addListener("onPhoneApproval", listener);
  return () => subscription.remove();
}

/** 平台适配器：app 侧只认这一份接口。 */
export const phoneToolsAdapter: PhoneToolsAdapter = {
  status: phoneStatus,
  setA11yEnabled: setPhoneA11yEnabled,
  setShellEnabled: setPhoneShellEnabled,
  openAccessibilitySettings: openPhoneAccessibilitySettings,
  requestShellPermission: requestPhoneShellPermission,
  openShellManager: openPhoneShellManager,
  mcpServer: phoneMcpServer,
};