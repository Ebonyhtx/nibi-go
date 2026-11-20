// 市场快照的本地持久化与刷新：filesDir/nibi-market.json 存“上次接受的索引 + 状态”。
//
// 刷新失败（网络/验签/回滚/版本不变量）一律保留旧快照；只有 accept 才覆盖。
// 网络取字节在这里（expo/RN fetch），判决逻辑在 @nibi-go/market-index。

import { Directory, File, Paths } from "expo-file-system";

import {
  refreshMarketIndex,
  type MarketIndex,
  type MarketRefreshResult,
  type MarketSnapshotState,
} from "@nibi-go/market-index";

import { MARKET_INDEX_URLS } from "./marketSource";
import { fetchBytes } from "./fetchBytes";

const SNAPSHOT_FILE = "nibi-market.json";
const INDEX_MAX_BYTES = 2 * 1024 * 1024;

export interface MarketSnapshotFile {
  version: 1;
  fetchedAt: string;
  state: MarketSnapshotState;
  index: MarketIndex;
}

function snapshotFile(): File {
  return new File(Paths.document, SNAPSHOT_FILE);
}

function parseSnapshot(text: string): MarketSnapshotFile | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null) return null;
    const value = raw as Partial<MarketSnapshotFile>;
    if (value.version !== 1) return null;
    if (!value.state || typeof value.state.revision !== "number") return null;
    if (!value.index || !Array.isArray(value.index.plugins)) return null;
    return value as MarketSnapshotFile;
  } catch {
    return null;
  }
}

/** 读本地快照，并区分“没有”与“坏掉”（坏文件不影响下一次刷新）。 */
export async function readMarketSnapshot(): Promise<{
  snapshot: MarketSnapshotFile | null;
  corrupt: boolean;
}> {
  const file = snapshotFile();
  if (!file.exists) return { snapshot: null, corrupt: false };
  try {
    const text = await file.text();
    const snapshot = parseSnapshot(text);
    return { snapshot, corrupt: snapshot === null };
  } catch {
    return { snapshot: null, corrupt: true };
  }
}

/** 读本地快照；没有或坏掉都返回 null。 */
export async function loadMarketSnapshot(): Promise<MarketSnapshotFile | null> {
  return (await readMarketSnapshot()).snapshot;
}

async function writeSnapshot(snapshot: MarketSnapshotFile): Promise<void> {
  const file = snapshotFile();
  const temp = new File(Paths.document, `${SNAPSHOT_FILE}.tmp`);
  if (temp.exists) temp.delete();
  temp.create();
  temp.write(JSON.stringify(snapshot));
  if (file.exists) file.delete();
  temp.move(file);
}

export interface RefreshMarketOutcome {
  result: MarketRefreshResult;
  /** accept 之后的快照；失败时为 null。 */
  snapshot: MarketSnapshotFile | null;
}

/** 拉取并校验官方索引；accept 时原子写入快照。 */
export async function refreshMarket(): Promise<RefreshMarketOutcome> {
  const previous = await loadMarketSnapshot();
  let lastFailure: MarketRefreshResult | null = null;
  for (const source of MARKET_INDEX_URLS) {
    const result = await refreshMarketIndex((url) => fetchBytes(url, INDEX_MAX_BYTES), {
      indexUrl: source,
      previous: previous?.state ?? null,
      previousIndex: previous?.index ?? null,
    });
    if (!result.ok) {
      lastFailure = result;
      continue;
    }
    if (result.kind === "unchanged") return { result, snapshot: null };
    const snapshot: MarketSnapshotFile = {
      version: 1,
      fetchedAt: new Date().toISOString(),
      state: result.state,
      index: result.index,
    };
    await writeSnapshot(snapshot);
    return { result, snapshot };
  }
  return { result: lastFailure ?? { ok: false, kind: "fetch", detail: "没有可用的市场源" }, snapshot: null };
}

/** 当前索引里某个 id 的条目（快照为空时返回 undefined）。 */
export function findMarketPlugin(
  snapshot: MarketSnapshotFile | null,
  id: string,
): MarketIndex["plugins"][number] | undefined {
  return snapshot?.index.plugins.find((plugin) => plugin.id === id);
}
