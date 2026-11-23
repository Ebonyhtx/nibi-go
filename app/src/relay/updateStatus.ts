// 更新检查状态：最近检查时间 + 待安装版本；供启动静默检查与设置页红点共用。
// 只存本地 JSON，不上报；检查失败不覆盖已有的待安装版本，避免红点闪断。
import { AppState } from "react-native";
import { useEffect, useState } from "react";
import { Directory, File, Paths } from "expo-file-system";

import { getCachedDevicePreferences } from "../settings/devicePreferences";
import { checkForUpdate } from "./updater";
import type { UpdateInfo } from "./updater-core";

const DIRECTORY = ".nibi";
const FILE_NAME = "nibi-update-state.json";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5_000;

export interface UpdateStatus {
  /** 上次检查完成时间（毫秒时间戳）；0 表示从未检查。 */
  lastCheckAt: number;
  /** 已发现但尚未安装的新版本。 */
  pending: UpdateInfo | null;
}

const EMPTY: UpdateStatus = { lastCheckAt: 0, pending: null };
let cached: UpdateStatus = EMPTY;
let loaded = false;
let checking = false;
const listeners = new Set<() => void>();

function stateFile(): File {
  new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
  return new File(Paths.document, DIRECTORY, FILE_NAME);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function normalizePending(value: unknown): UpdateInfo | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "string") return null;
  if (typeof record.apkUrl !== "string") return null;
  if (!Array.isArray(record.urls) || record.urls.some((url) => typeof url !== "string")) {
    return null;
  }
  return record as unknown as UpdateInfo;
}

function normalize(raw: unknown): UpdateStatus {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...EMPTY };
  const record = raw as Record<string, unknown>;
  const lastCheckAt =
    typeof record.lastCheckAt === "number" && Number.isFinite(record.lastCheckAt)
      ? record.lastCheckAt
      : 0;
  return { lastCheckAt, pending: normalizePending(record.pending) };
}

export async function loadUpdateStatus(): Promise<UpdateStatus> {
  if (loaded) return cached;
  try {
    const file = stateFile();
    if (file.exists) cached = normalize(JSON.parse(await file.text()));
  } catch {
    cached = { ...EMPTY };
  }
  loaded = true;
  notify();
  return cached;
}

export function getCachedUpdateStatus(): UpdateStatus {
  return cached;
}

export function subscribeUpdateStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function saveUpdateStatus(patch: Partial<UpdateStatus>): Promise<void> {
  cached = { ...cached, ...patch };
  loaded = true;
  notify();
  try {
    await stateFile().write(`${JSON.stringify(cached, null, 2)}\n`);
  } catch {
    // 状态文件写失败不影响本次会话的红点/检查节流。
  }
}

export function useUpdateStatus(): UpdateStatus {
  const [state, setState] = useState(getCachedUpdateStatus());
  useEffect(() => subscribeUpdateStatus(() => setState({ ...getCachedUpdateStatus() })), []);
  return state;
}

/**
 * 启动/回前台静默检查：默认开启；关闭后完全不发检查请求。
 * 只更新本地状态与红点，不自动下载，也不打扰用户。
 */
export function useUpdateAutoCheck(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const maybeCheck = async () => {
      if (checking) return;
      if (AppState.currentState === "background") return;
      if (!getCachedDevicePreferences().autoCheckUpdate) return;
      const state = await loadUpdateStatus();
      if (!alive) return;
      if (Date.now() - state.lastCheckAt < CHECK_INTERVAL_MS) return;

      checking = true;
      try {
        const result = await checkForUpdate();
        if (!alive || !getCachedDevicePreferences().autoCheckUpdate) return;
        const checkedAt = Date.now();
        if (result.status === "update") {
          await saveUpdateStatus({ lastCheckAt: checkedAt, pending: result.info });
        } else if (result.status === "none") {
          await saveUpdateStatus({ lastCheckAt: checkedAt, pending: null });
        } else {
          // 检查失败保留已有的待安装版本，只推进节流时间。
          await saveUpdateStatus({ lastCheckAt: checkedAt });
        }
      } finally {
        checking = false;
      }
    };

    const timer = setTimeout(() => void maybeCheck(), INITIAL_DELAY_MS);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void maybeCheck();
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [enabled]);
}
