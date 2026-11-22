// 市场快照与个人插件源的本地持久化与刷新：
// - filesDir/nibi-market.json 存“上次接受的公开索引 + 状态”；
// - filesDir/nibi-market-personal.json 存用户在「个人」子页添加的自定义插件包源。
//
// 刷新失败（网络/验签/回滚/版本不变量）一律保留旧快照；只有 accept 才覆盖。
// 网络取字节在这里（expo/RN fetch），判决逻辑在 @nibi-go/market-index。

import { File, Paths } from "expo-file-system";

import {
  refreshMarketIndexFromSources,
  type MarketIndex,
  type MarketPluginEntry,
  type MarketRefreshResult,
  type MarketSnapshotState,
} from "@nibi-go/market-index";

import {
  currentMarketRegion,
  marketIndexUrlsForRegion,
  type MarketRegion,
} from "./marketSource";
import { fetchBytes } from "./fetchBytes";

const SNAPSHOT_FILE = "nibi-market.json";
const PERSONAL_FILE = "nibi-market-personal.json";
const INDEX_MAX_BYTES = 2 * 1024 * 1024;

/** 早期链路联调专用的最小示例 id，不在正式市场面向用户展示。 */
const HIDDEN_MARKET_IDS = new Set(["nibi.market.hello"]);

export interface MarketSnapshotFile {
  version: 1;
  fetchedAt: string;
  state: MarketSnapshotState;
  index: MarketIndex;
}

export interface PersonalPluginSource {
  id: string;
  name: string;
  /** zip 直链地址或 `npm:<packageName[@version]>` 标识。 */
  url: string;
  kind?: "zip" | "npm";
  addedAt: string;
  installedPluginId?: string;
}

function snapshotFile(): File {
  return new File(Paths.document, SNAPSHOT_FILE);
}

function personalFile(): File {
  return new File(Paths.document, PERSONAL_FILE);
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
  await temp.write(JSON.stringify(snapshot));
  if (file.exists) file.delete();
  await temp.move(file);
}

export interface RefreshMarketOutcome {
  result: MarketRefreshResult;
  /** accept 之后的快照；失败时为 null。 */
  snapshot: MarketSnapshotFile | null;
}

/** 拉取并校验索引；按当前所选「国内源 / 国外源」优先级并发拉取，accept 时原子写入快照。 */
export async function refreshMarket(region?: MarketRegion): Promise<RefreshMarketOutcome> {
  const activeRegion = region ?? currentMarketRegion();
  const previous = await loadMarketSnapshot();
  const result = await refreshMarketIndexFromSources(
    (url) => fetchBytes(url, INDEX_MAX_BYTES, { cacheBust: true }),
    {
      indexUrls: marketIndexUrlsForRegion(activeRegion),
      previous: previous?.state ?? null,
      previousIndex: previous?.index ?? null,
    },
  );
  if (!result.ok || result.kind === "unchanged") return { result, snapshot: null };
  const snapshot: MarketSnapshotFile = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    state: result.state,
    index: result.index,
  };
  await writeSnapshot(snapshot);
  return { result, snapshot };
}

/** 当前索引里某个 id 的条目（快照为空时返回 undefined）。 */
export function findMarketPlugin(
  snapshot: MarketSnapshotFile | null,
  id: string,
): MarketIndex["plugins"][number] | undefined {
  return snapshot?.index.plugins.find((plugin) => plugin.id === id);
}

/** 判断一条远端索引插件是否归属「NIBI」官方子页（其余归属「公开」子页）。 */
export function isOfficialNibiMarketEntry(entry: MarketPluginEntry): boolean {
  const pub = (entry.publisher ?? "").toLowerCase();
  return pub.includes("nibi") || entry.id.startsWith("nibi.") || entry.id.startsWith("nibigo-");
}

/** 过滤掉联调测试条目后的可见索引条目。 */
export function visibleMarketEntries(snapshot: MarketSnapshotFile | null): MarketPluginEntry[] {
  if (!snapshot) return [];
  return snapshot.index.plugins.filter((entry) => !HIDDEN_MARKET_IDS.has(entry.id));
}

export async function loadPersonalSources(): Promise<PersonalPluginSource[]> {
  try {
    const file = personalFile();
    if (!file.exists) return [];
    const parsed = JSON.parse(await file.text()) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PersonalPluginSource =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as PersonalPluginSource).id === "string" &&
        typeof (item as PersonalPluginSource).url === "string",
    );
  } catch {
    return [];
  }
}

export async function savePersonalSources(sources: PersonalPluginSource[]): Promise<void> {
  const file = personalFile();
  if (!file.exists) file.create();
  await file.write(JSON.stringify(sources, null, 2));
}
