// 凭据持久化（AGENTS 规则 14：token 不进对话/日志/备份/插件目录）。
// JWT/refresh_token 与配对凭据都放 expo-secure-store（Android Keystore 加密，
// 不进云备份）；只存 token 与配对标识，不存任何会话内容。
import * as SecureStore from "expo-secure-store";

import type { PairCredential, PairCredentialStore } from "@nibi-go/relay-client";

const TOKEN_KEY = "nibi.go.tokens";
const PAIR_KEY = "nibi.go.pair";

export interface StoredTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  displayName?: string;
}

async function readJson<T>(key: string): Promise<T | undefined> {
  const raw = await SecureStore.getItemAsync(key).catch(() => null);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(value)).catch(() => {
    // 写入失败不阻断流程（对齐 §06：存储失败静默，登录态在内存仍有效）
  });
}

export const tokenStore = {
  load: () => readJson<StoredTokenSet>(TOKEN_KEY),
  save: (tokens: StoredTokenSet) => writeJson(TOKEN_KEY, tokens),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
};

export const pairCredentialStore: PairCredentialStore = {
  load: () => readJson<PairCredential>(PAIR_KEY),
  save: (credential) => writeJson(PAIR_KEY, credential),
  clear: () => SecureStore.deleteItemAsync(PAIR_KEY).catch(() => {}),
};
