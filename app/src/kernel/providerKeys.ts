// Provider API key 的 Android Keystore 存储（D25 可用性收口）。
//
// `provider_config.json` 只存 Provider 的端点/模型/规则，不存 key；key 放
// expo-secure-store（Android Keystore），内核启动后由 Host 经 `provider/setKeys`
// 送进内存。这样 at-rest 只有 Keystore 里的密文，配置文件和会话库里没有 key。
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "nibi.providerKeys.v1";

export type ProviderKeyMap = Record<string, string>;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function loadProviderKeys(): Promise<ProviderKeyMap> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: ProviderKeyMap = {};
    for (const [providerId, key] of Object.entries(parsed as Record<string, unknown>)) {
      const value = clean(key);
      if (providerId && value) map[providerId] = value;
    }
    return map;
  } catch {
    // Keystore 不可用/内容损坏：按没有 key 处理（provider 会在设置页显示待填）。
    return {};
  }
}

async function storeProviderKeys(map: ProviderKeyMap): Promise<void> {
  if (Object.keys(map).length === 0) {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(map));
}

/** 保存/清除一个 Provider 的 key；空白 key 表示清除。 */
export async function setProviderKey(providerId: string, key: string): Promise<void> {
  const map = await loadProviderKeys();
  const value = clean(key);
  if (value) map[providerId] = value;
  else delete map[providerId];
  await storeProviderKeys(map);
}

export async function removeProviderKey(providerId: string): Promise<void> {
  const map = await loadProviderKeys();
  if (!(providerId in map)) return;
  delete map[providerId];
  await storeProviderKeys(map);
}

interface KernelRpc {
  request<T = unknown>(method: string, params: unknown): Promise<T>;
}

/**
 * 启动内核时带上的 env（`NIBI_PROVIDER_KEYS`）：内核在**启动时**算默认模型，必须在
 * `startKernelHost` 之前就把 key 给它，否则目录里没有可执行模型、新会话拿不到选择。
 */
export async function providerKeysEnv(): Promise<Record<string, string>> {
  const keys = await loadProviderKeys();
  return Object.keys(keys).length > 0
    ? { NIBI_PROVIDER_KEYS: JSON.stringify(keys) }
    : {};
}

/**
 * 把 Keystore 里的 key 送到内核内存（`provider/setKeys`）。启动后新增/删除 key 时用；
 * 首次启动的默认模型计算靠 [`providerKeysEnv`]。
 * 返回内核收到的 key 数量。
 */
export async function pushProviderKeys(client: KernelRpc): Promise<number> {
  const keys = await loadProviderKeys();
  const result = await client.request<{ updated?: unknown }>("provider/setKeys", { keys });
  return typeof result?.updated === "number" ? result.updated : Object.keys(keys).length;
}