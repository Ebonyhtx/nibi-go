// 已安装市场插件的记录（版本 + 是否付费）。
//
// 为什么单独记 paid：插件目录可以被复制到别的机器，只看市场快照等于没拦复制件；
// 安装时把 paid 落盘，门禁取「快照 paid ∪ 安装记录 paid」。

import { File, Paths } from "expo-file-system";

import { loadMarketSnapshot } from "./marketStore";

const RECORD_FILE = "nibi-market-installed.json";

export interface InstalledPluginRecord {
  version: string;
  paid: boolean;
}

interface RecordFile {
  version: 1;
  plugins: Record<string, InstalledPluginRecord>;
}

function recordFile(): File {
  return new File(Paths.document, RECORD_FILE);
}

export async function loadInstalledRecords(): Promise<Record<string, InstalledPluginRecord>> {
  const file = recordFile();
  if (!file.exists) return {};
  try {
    const raw: unknown = JSON.parse(await file.text());
    if (typeof raw !== "object" || raw === null) return {};
    const value = raw as Partial<RecordFile>;
    if (value.version !== 1 || typeof value.plugins !== "object" || value.plugins === null) return {};
    return value.plugins;
  } catch {
    return {};
  }
}

async function writeRecords(plugins: Record<string, InstalledPluginRecord>): Promise<void> {
  const file = recordFile();
  const temp = new File(Paths.document, `${RECORD_FILE}.tmp`);
  if (temp.exists) temp.delete();
  temp.create();
  await temp.write(JSON.stringify({ version: 1, plugins } satisfies RecordFile));
  if (file.exists) file.delete();
  await temp.move(file);
}

export async function recordInstalledPlugin(
  id: string,
  version: string,
  paid: boolean,
): Promise<void> {
  const plugins = await loadInstalledRecords();
  plugins[id] = { version, paid };
  await writeRecords(plugins);
}

export async function forgetInstalledPlugin(id: string): Promise<void> {
  const plugins = await loadInstalledRecords();
  if (!(id in plugins)) return;
  delete plugins[id];
  await writeRecords(plugins);
}

/** 付费插件 id 集合：市场快照里 paid 的 ∪ 安装记录里 paid 的。 */
export async function paidPluginIds(): Promise<Set<string>> {
  const paid = new Set<string>();
  const records = await loadInstalledRecords();
  for (const [id, record] of Object.entries(records)) {
    if (record.paid) paid.add(id);
  }
  const snapshot = await loadMarketSnapshot();
  for (const plugin of snapshot?.index.plugins ?? []) {
    if (plugin.paid) paid.add(plugin.id);
  }
  return paid;
}
