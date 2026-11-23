// 手机操控的 App 侧状态入口：薄封装 nibi-phone 原生桥，并向会话层广播服务器变更。
//
// 只有这里接触原生模块；设置页与 kernel hook 都从这里取状态/开关。
// MCP 地址与 bearer token 只在本机内存里流转，不打印、不落盘。

import {
  canShowPhoneApproval as canShowOverlay,
  installPhoneShellManager as installShellManager,
  openPhoneAccessibilitySettings as openA11ySettings,
  openPhoneAppSettings as openAppSettings,
  openPhoneInstallPermissionSettings as openInstallPermissionSettings,
  openPhoneOverlaySettings as openOverlaySettings,
  openPhoneShellManager as openShellManager,
  phoneMcpGeneration as readMcpGeneration,
  phoneMcpServer as readMcpServer,
  phoneStatus as readPhoneStatus,
  requestPhoneShellPermission as requestShellPermission,
  setPhoneA11yEnabled as applyA11yEnabled,
  setPhoneShellEnabled as applyShellEnabled,
  type ShellInstallResult,
} from "nibi-phone";

import {
  phoneMcpServerFor,
  phoneToolsEnabled,
  type PhoneMcpServerConfig,
  type PhoneStatus,
} from "@nibi-go/phone-tools";

const listeners = new Set<() => void>();
let revision = 0;
/** 已交给内核的服务器代次；undefined 表示本进程还没观察过。 */
let attachedGeneration: number | null | undefined;

/** 开关对“是否把 phone MCP 交给内核”的实际影响；同值写入或仅连接状态变化不算。 */
function attachmentFlags(status: PhoneStatus): string {
  return [
    status.available ? "1" : "0",
    status.a11y.enabled ? "1" : "0",
    status.shell.enabled ? "1" : "0",
  ].join(":");
}

function notifyChanged(): void {
  revision += 1;
  // 复制一份再遍历：监听器里取消订阅不能影响本轮其它监听器。
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 订阅方异常不阻断开关本身的返回结果。
    }
  }
}

function applySettingChange(mutate: () => PhoneStatus): PhoneStatus {
  const before = attachmentFlags(readPhoneStatus());
  const status = mutate();
  if (attachmentFlags(status) !== before) notifyChanged();
  return status;
}

export function phoneStatus(): PhoneStatus {
  return readPhoneStatus();
}

export function isPhoneToolsEnabled(): boolean {
  return phoneToolsEnabled(phoneStatus());
}

/** 只在至少一个开关打开且原生 MCP 可用时返回配置；否则为 null。 */
export function phoneMcpServer(): PhoneMcpServerConfig | null {
  const config = phoneMcpServerFor(phoneStatus(), { mcpServer: readMcpServer });
  const generation = config ? readMcpGeneration() : null;
  // undefined = 本次进程还没观察过（首次取配置只记录，不触发 resume）。
  // 代次变化说明 loopback 服务器被重建或关闭：内核里的旧 MCP 客户端已经失效，
  // 必须 resume 一次把新地址交给它，否则后续工具调用只会报 “MCP is shut down”。
  if (attachedGeneration !== undefined && generation !== attachedGeneration) {
    notifyChanged();
  }
  attachedGeneration = generation;
  return config;
}

/** App 回到前台时调用：确保服务器仍在，并在代次变化时触发会话重新挂载。 */
export function refreshPhoneMcpAttachment(): void {
  phoneMcpServer();
}

export function setPhoneA11yEnabled(enabled: boolean): PhoneStatus {
  return applySettingChange(() => applyA11yEnabled(enabled));
}

export function setPhoneShellEnabled(enabled: boolean): PhoneStatus {
  return applySettingChange(() => applyShellEnabled(enabled));
}

export function openPhoneAccessibilitySettings(): void {
  openA11ySettings();
}

export function requestPhoneShellPermission(): boolean {
  return requestShellPermission();
}

export function openPhoneShellManager(): boolean {
  return openShellManager();
}

/** 随包内置 Shizuku 的一键安装；permission_required 时调用方引导去系统授权页。 */
export function installPhoneShellManager(): Promise<ShellInstallResult> {
  return installShellManager();
}

export function openPhoneInstallPermissionSettings(): void {
  openInstallPermissionSettings();
}

export type { ShellInstallResult };

/** 悬浮审批权限（系统「显示在其他应用上层」）。 */
export function canShowPhoneApproval(): boolean {
  return canShowOverlay();
}

export function openPhoneOverlaySettings(): void {
  openOverlaySettings();
}

/** 打开应用信息页（ColorOS 的「后台弹出界面」等系统权限在这里）。 */
export function openPhoneAppSettings(): void {
  openAppSettings();
}

/**
 * 订阅手机工具变更（a11y/shell 开关的实际有效值变化）。
 * 返回取消订阅函数；会话层用 revision 去重，避免重复 resume。
 */
export function subscribePhoneToolsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function phoneToolsRevision(): number {
  return revision;
}
