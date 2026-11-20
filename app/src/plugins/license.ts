// 付费插件授权：token 存 expo-secure-store（Keystore 加密），设备 id 首次生成后固定。
//
// 判定在 @nibi-go/plugin-license（离线验签 + exp + dev 绑定 + 覆盖范围）。
// 未加载时按“没有凭证”处理（fail-closed）；任何读失败都当没有。

import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { evaluatePluginLicense, type PluginLicenseDecision } from "@nibi-go/plugin-license";

const TOKEN_KEY = "nibi.go.plugin.license";
const DEVICE_KEY = "nibi.go.device.id";

interface LicenseState {
  loaded: boolean;
  token: string | null;
  deviceId: string | null;
}

const state: LicenseState = { loaded: false, token: null, deviceId: null };

async function readDeviceId(): Promise<string | null> {
  try {
    const existing = await SecureStore.getItemAsync(DEVICE_KEY);
    if (existing) return existing;
    const created = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

/** 首次进入插件/市场路径时调用；之后判定走内存缓存。 */
export async function ensureLicenseLoaded(): Promise<void> {
  if (state.loaded) return;
  const [token, deviceId] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
    readDeviceId(),
  ]);
  state.token = token?.trim() || null;
  state.deviceId = deviceId;
  state.loaded = true;
}

/** 强制重读（换凭证/退出登录后调用）。 */
export async function refreshLicense(): Promise<void> {
  state.loaded = false;
  await ensureLicenseLoaded();
}

/** 设置/清除本机凭证；token 只进 SecureStore，不打印。 */
export async function setLicenseToken(token: string | null): Promise<void> {
  const trimmed = token?.trim() || null;
  if (trimmed) await SecureStore.setItemAsync(TOKEN_KEY, trimmed);
  else await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  state.token = trimmed;
  state.loaded = true;
}

/** 某个插件 id 的授权判定（同步；未加载视为未授权）。 */
export function pluginLicenseDecision(pluginId: string): PluginLicenseDecision {
  return evaluatePluginLicense({
    token: state.token,
    deviceId: state.deviceId,
    pluginId,
  });
}

export function licenseSummary(): { activated: boolean; expiresAt: string | null; reason: string } {
  if (!state.token) {
    return { activated: false, expiresAt: null, reason: "这台设备还没有付费插件授权" };
  }
  // 用通配插件 id 只取凭证本身的到期/设备信息；覆盖范围仍按具体插件判。
  const decision = evaluatePluginLicense({
    token: state.token,
    deviceId: state.deviceId,
    pluginId: "*",
  });
  const activated = decision.status === "active" || decision.status === "not_covered";
  return { activated, expiresAt: decision.expiresAt, reason: decision.reason };
}
