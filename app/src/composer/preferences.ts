// COMPOSE 配置持久化：胶囊快捷动作、加号菜单内容/顺序、长按消息菜单内容。
//
// 只存稳定 id；目录（catalog）变化时按 known 集合补新项，避免升级后新命令/技能
// 静默消失，同时保留用户已经关掉的旧项。

import { Directory, File, Paths } from "expo-file-system";

import {
  capsuleEligible,
  defaultCapsuleIds,
  messageEligible,
  PLUS_GROUPS,
  type ComposerCatalogItem,
  type ComposerGroup,
} from "./catalog";

export type PlusGroup = Exclude<ComposerGroup, "message">;

export interface ComposerPreferences {
  version: 1;
  /** 已经见过的目录 id；用来区分“新目录项”和“用户关掉的旧项”。 */
  known: string[];
  capsules: string[];
  plus: Record<PlusGroup, string[]>;
  messageActions: string[];
}

const FILE_NAME = "nibi-composer.json";
const DIRECTORY = ".nibi";
let cached: ComposerPreferences | null = null;
const listeners = new Set<(preferences: ComposerPreferences) => void>();

function emptyPlus(): Record<PlusGroup, string[]> {
  const plus = {} as Record<PlusGroup, string[]>;
  for (const { group } of PLUS_GROUPS) plus[group] = [];
  return plus;
}

function sortBySource(items: readonly ComposerCatalogItem[]): ComposerCatalogItem[] {
  return [...items].sort((left, right) => {
    if (left.source !== right.source) return left.source === "nibi" ? -1 : 1;
    return 0;
  });
}

function defaults(catalog: readonly ComposerCatalogItem[]): ComposerPreferences {
  const plus = emptyPlus();
  for (const { group } of PLUS_GROUPS) {
    plus[group] = sortBySource(catalog.filter((item) => item.group === group)).map(
      (item) => item.id,
    );
  }
  return {
    version: 1,
    known: catalog.map((item) => item.id),
    capsules: defaultCapsuleIds(catalog),
    plus,
    messageActions: sortBySource(catalog.filter(messageEligible)).map((item) => item.id),
  };
}

/** 目录可能异步加载：先保留未知 id，等目录到齐后再由渲染层过滤。
 *
 * 不能在 normalize 时按当前 catalog 裁剪：冷启动时插件还没读出来，会把用户
 * 已启用的插件命令/技能永久从配置里删掉（而且 known 里已有这些 id，不会再补回来）。
 */
function filterIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  return ids.filter((id): id is string => {
    if (typeof id !== "string" || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** 合并目录变化：新项默认加入加号/长按菜单，但不自动进胶囊（胶囊由用户明确选择）。 */
export function normalizePreferences(
  raw: unknown,
  catalog: readonly ComposerCatalogItem[],
): ComposerPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults(catalog);
  const value = raw as Partial<ComposerPreferences>;
  const known = new Set(
    Array.isArray(value.known)
      ? value.known.filter((id): id is string => typeof id === "string")
      : [],
  );
  const plus = emptyPlus();
  for (const { group } of PLUS_GROUPS) {
    const configured = Array.isArray(value.plus?.[group]) ? value.plus[group] : [];
    plus[group] = filterIds(configured);
  }
  for (const item of sortBySource(catalog)) {
    if (known.has(item.id)) continue;
    if (item.group === "message") continue;
    plus[item.group].push(item.id);
  }
  const nextKnown = new Set([...known, ...catalog.map((item) => item.id)]);
  const capsules = filterIds(
    Array.isArray(value.capsules) ? value.capsules : defaultCapsuleIds(catalog),
  );
  const messageActions = filterIds(
    Array.isArray(value.messageActions)
      ? value.messageActions
      : catalog.filter(messageEligible).map((item) => item.id),
  );
  for (const item of sortBySource(catalog)) {
    if (!messageEligible(item) || known.has(item.id)) continue;
    if (!messageActions.includes(item.id)) messageActions.push(item.id);
  }
  return {
    version: 1,
    known: [...nextKnown],
    capsules,
    plus,
    messageActions,
  };
}

function preferenceFile(): File {
  new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
  return new File(Paths.document, DIRECTORY, FILE_NAME);
}

// expo-file-system 的 File 没有跨目录 mkdir 的父级保证时，先保证 .nibi 存在。
// （Paths.document 本身存在；这里只补一层隐藏目录。）

export async function loadComposerPreferences(
  catalog: readonly ComposerCatalogItem[],
): Promise<ComposerPreferences> {
  if (cached) return normalizePreferences(cached, catalog);
  let raw: unknown;
  try {
    const file = preferenceFile();
    if (file.exists) raw = JSON.parse(await file.text());
  } catch {
    raw = undefined;
  }
  const preferences = normalizePreferences(raw, catalog);
  cached = preferences;
  return preferences;
}

export async function saveComposerPreferences(
  preferences: ComposerPreferences,
): Promise<void> {
  cached = preferences;
  for (const listener of listeners) listener(preferences);
  try {
    await preferenceFile().write(`${JSON.stringify(preferences, null, 2)}\n`);
  } catch (error) {
    console.warn("[nibigo] 保存 COMPOSE 配置失败", error);
  }
}

export function getCachedComposerPreferences(): ComposerPreferences | null {
  return cached;
}

export function subscribeComposerPreferences(
  listener: (preferences: ComposerPreferences) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 设置页的单个开关/排序操作：只在当前目录允许的项内改。 */
export function toggleInList(list: readonly string[], id: string, enabled: boolean): string[] {
  if (enabled) return list.includes(id) ? [...list] : [...list, id];
  return list.filter((item) => item !== id);
}

export function moveInList(list: readonly string[], id: string, delta: -1 | 1): string[] {
  const index = list.indexOf(id);
  if (index < 0) return [...list];
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}