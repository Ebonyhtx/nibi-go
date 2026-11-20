// 付费插件授权：token 与“上次在线检查”快照存 expo-secure-store（Keystore 加密），
// 设备 id 首次生成后固定。
//
// 判定在 @nibi-go/plugin-license（离线验签 + exp + dev 绑定 + 账号绑定 + 72h/7d 宽限
// + 覆盖范围）；服务端明确拒绝（lastRefusal）直接拒绝；未加载时按“没有凭证”处理（fail-closed）。

import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { evaluatePluginLicense, type PluginLicenseDecision } from "@nibi-go/plugin-license";

const TOKEN_KEY = "nibi.go.plugin.license";
const STATE_KEY = "nibi.go.plugin.license.state";
const DEVICE_KEY = "nibi.go.device.id";

export interface LicenseSnapshot {
  /** 上次成功在线检查的时刻（ISO）。 */
  lastCheckAt: string | null;
  plan: string | null;
  expiresAt: string | null;
  /** 服务端明确拒绝的原因；有值即 deny（撤销/过期/设备不匹配）。 */
  lastRefusal: string | null;
  /** 签发时绑定的 Zitadel 账号（sub）；换号后旧凭证立即失效。 */
  accountId: string | null;
  /** 服务端 policy；缺省按 72h 检查、7 天离线宽限。 */
  checkIntervalHours: number | null;
  offlineGraceDays: number | null;
}

const EMPTY_STATE: LicenseSnapshot = {
  lastCheckAt: null,
  plan: null,
  expiresAt: null,
  lastRefusal: null,
  accountId: null,
  checkIntervalHours: null,
  offlineGraceDays: null,
};

interface LicenseState extends LicenseSnapshot {
  loaded: boolean;
  token: string | null;
  deviceId: string | null;
}

const state: LicenseState = { ...EMPTY_STATE, loaded: false, token: null, deviceId: null };

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

function parseSnapshot(raw: string | null): LicenseSnapshot {
  if (!raw) return { ...EMPTY_STATE };
  try {
    const value = JSON.parse(raw) as Partial<LicenseSnapshot>;
    return {
      lastCheckAt: typeof value.lastCheckAt === "string" ? value.lastCheckAt : null,
      plan: typeof value.plan === "string" ? value.plan : null,
      expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : null,
      lastRefusal: typeof value.lastRefusal === "string" ? value.lastRefusal : null,
      accountId: typeof value.accountId === "string" ? value.accountId : null,
      checkIntervalHours:
        typeof value.checkIntervalHours === "number" ? value.checkIntervalHours : null,
      offlineGraceDays:
        typeof value.offlineGraceDays === "number" ? value.offlineGraceDays : null,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** 首次进入插件/市场路径时调用；之后判定走内存缓存。 */
export async function ensureLicenseLoaded(): Promise<void> {
  if (state.loaded) return;
  const [token, deviceId, rawState] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
    readDeviceId(),
    SecureStore.getItemAsync(STATE_KEY).catch(() => null),
  ]);
  state.token = token?.trim() || null;
  state.deviceId = deviceId;
  Object.assign(state, parseSnapshot(rawState));
  state.loaded = true;
}

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

export async function saveLicenseSnapshot(snapshot: Partial<LicenseSnapshot>): Promise<void> {
  Object.assign(state, snapshot);
  const value: LicenseSnapshot = {
    lastCheckAt: state.lastCheckAt,
    plan: state.plan,
    expiresAt: state.expiresAt,
    lastRefusal: state.lastRefusal,
    accountId: state.accountId,
    checkIntervalHours: state.checkIntervalHours,
    offlineGraceDays: state.offlineGraceDays,
  };
  await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(value)).catch(() => {});
}

/** 换号/退出时清掉本机授权；调用方负责随后重新 /check。 */
export async function clearLicense(): Promise<void> {
  await setLicenseToken(null);
  Object.assign(state, EMPTY_STATE);
  await SecureStore.deleteItemAsync(STATE_KEY).catch(() => {});
}

export function currentLicenseToken(): string | null {
  return state.token;
}

export function currentDeviceId(): string | null {
  return state.deviceId;
}

export function licenseSnapshot(): LicenseSnapshot {
  return {
    lastCheckAt: state.lastCheckAt,
    plan: state.plan,
    expiresAt: state.expiresAt,
    lastRefusal: state.lastRefusal,
    accountId: state.accountId,
    checkIntervalHours: state.checkIntervalHours,
    offlineGraceDays: state.offlineGraceDays,
  };
}

export function currentLicenseAccountId(): string | null {
  return state.accountId;
}

/** 在线检查间隔（桌面同口径：10 分钟；进入市场/启动时用缓存先渲染，再后台续期）。 */
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

/** 是否值得联网换证：没检查过、上次检查超过 10 分钟，或服务端上次明确拒绝。 */
export function licenseNeedsSync(now = Date.now()): boolean {
  if (!state.lastCheckAt) return true;
  const checkedAt = Date.parse(state.lastCheckAt);
  return !Number.isFinite(checkedAt) || now - checkedAt >= SYNC_INTERVAL_MS || state.lastRefusal !== null;
}

/** 某个插件 id 的授权判定（同步；未加载视为未授权）。 */
export function pluginLicenseDecision(pluginId: string): PluginLicenseDecision {
  if (state.lastRefusal) {
    return {
      status: "denied",
      allowed: false,
      reason: `服务端已拒绝：${state.lastRefusal}`,
      claims: null,
      expiresAt: state.expiresAt,
    };
  }
  return evaluatePluginLicense({
    token: state.token,
    deviceId: state.deviceId,
    pluginId,
    accountId: state.accountId,
    lastCheckAt: state.lastCheckAt,
    ...(state.checkIntervalHours === null ? {} : { checkIntervalHours: state.checkIntervalHours }),
    ...(state.offlineGraceDays === null ? {} : { offlineGraceDays: state.offlineGraceDays }),
  });
}

export function licenseSummary(): {
  activated: boolean;
  grace: boolean;
  reason: string;
  plan: string | null;
  expiresAt: string | null;
} {
  const snapshot = licenseSnapshot();
  if (!state.token) {
    return {
      activated: false,
      grace: false,
      reason: "这台设备还没有付费插件授权",
      plan: snapshot.plan,
      expiresAt: snapshot.expiresAt,
    };
  }
  const decision = pluginLicenseDecision("*");
  const activated =
    decision.status === "active" ||
    decision.status === "grace" ||
    decision.status === "not_covered";
  return {
    activated,
    grace: decision.status === "grace",
    reason: decision.reason,
    plan: decision.claims?.plan ?? snapshot.plan,
    expiresAt: decision.expiresAt ?? snapshot.expiresAt,
  };
}
