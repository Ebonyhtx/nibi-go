// 项目（持久工作区）：多个会话共享一个 workspace 目录。
//
// 路径口径：`<filesDir>/projects/<projectId>/`——内核把 session/create 的 workspace
// 持久化为该会话唯一工作区，所以「会话属于哪个项目」由创建时选的项目决定，
// 之后从 session/list 的 workspacePath 前缀即可反查，不需要单独的映射表。
// 记忆、子智能体的项目级目录（.nibi/agents）都挂在项目 workspace 下。
//
// 持久化与设备偏好同一套：`.nibi/projects.json` + 内存缓存 + 订阅；读写失败
// 回落空列表，绝不向 UI 抛错。删除项目只删映射，不删磁盘目录（里面可能有
// 用户文件；孤儿目录由设置页的路径展示兜底说明）。

import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";

export interface ProjectEntry {
  /** 单段安全名（见 isSafeProjectId）：同时用作 workspace 目录名。 */
  id: string;
  name: string;
  createdAt: number;
}

export interface ProjectsState {
  version: 1;
  /** 列表按创建时间升序。 */
  projects: ProjectEntry[];
  /** 新建对话默认进入的项目；null = 不带项目（旧路径）。 */
  activeProjectId: string | null;
}

export const PROJECTS_DEFAULTS: ProjectsState = {
  version: 1,
  projects: [],
  activeProjectId: null,
};

const FILE_NAME = "projects.json";
const DIRECTORY = ".nibi";
let cached: ProjectsState | null = null;
const listeners = new Set<(state: ProjectsState) => void>();

function stateFile(): File {
  new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
  return new File(Paths.document, DIRECTORY, FILE_NAME);
}

/** 项目 id 同时是目录名：只允许小写字母/数字/连字符，1–40 位。 */
export function isSafeProjectId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);
}

function normalize(raw: unknown): ProjectsState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...PROJECTS_DEFAULTS };
  }
  const value = raw as { projects?: unknown; activeProjectId?: unknown };
  const projects = Array.isArray(value.projects)
    ? value.projects
        .map((entry) => {
          const item = entry as { id?: unknown; name?: unknown; createdAt?: unknown };
          const id = typeof item.id === "string" && isSafeProjectId(item.id) ? item.id : null;
          const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 60) : null;
          const createdAt = typeof item.createdAt === "number" ? item.createdAt : 0;
          return id && name ? ({ id, name, createdAt } satisfies ProjectEntry) : null;
        })
        .filter((entry): entry is ProjectEntry => entry !== null)
    : [];
  const active =
    typeof value.activeProjectId === "string" &&
    projects.some((entry) => entry.id === value.activeProjectId)
      ? value.activeProjectId
      : null;
  return { version: 1, projects, activeProjectId: active };
}

export async function loadProjects(): Promise<ProjectsState> {
  if (cached) return cached;
  let raw: unknown;
  try {
    const file = stateFile();
    if (file.exists) raw = JSON.parse(await file.text());
  } catch {
    raw = undefined;
  }
  cached = normalize(raw);
  for (const listener of listeners) listener(cached);
  return cached;
}

export function getCachedProjects(): ProjectsState {
  return cached ?? { ...PROJECTS_DEFAULTS };
}

export async function saveProjects(state: ProjectsState): Promise<void> {
  cached = state;
  for (const listener of listeners) listener(state);
  try {
    await stateFile().write(`${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    console.warn("[nibigo] 保存项目列表失败", error);
  }
}

export function subscribeProjects(listener: (state: ProjectsState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 便捷部分更新（读-改-写）。 */
export async function updateProjects(
  patch: (draft: ProjectsState) => ProjectsState,
): Promise<void> {
  await saveProjects(patch(getCachedProjects()));
}

export async function createProject(name: string, customId?: string): Promise<ProjectEntry> {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) throw new Error("项目名不能为空");
  // 自定义文件夹名（FAB 新建流程）：校验安全字符与重名；缺省用自动 id。
  let id: string;
  if (customId !== undefined) {
    if (!isSafeProjectId(customId)) throw new Error("文件夹名只能用小写字母、数字和连字符");
    if (getCachedProjects().projects.some((entry) => entry.id === customId)) {
      throw new Error(`文件夹名 ${customId} 已被占用`);
    }
    id = customId;
  } else {
    id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
  }
  const entry: ProjectEntry = { id, name: trimmed, createdAt: Date.now() };
  await updateProjects((current) => ({
    ...current,
    projects: [...current.projects, entry],
    activeProjectId: current.activeProjectId ?? entry.id,
  }));
  return entry;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) throw new Error("项目名不能为空");
  await updateProjects((current) => ({
    ...current,
    projects: current.projects.map((entry) => (entry.id === id ? { ...entry, name: trimmed } : entry)),
  }));
}

/** 只删映射；workspace 目录（项目里的文件）保留。删除后其下会话在抽屉归入「独立会话」。 */
export async function deleteProject(id: string): Promise<void> {
  await updateProjects((current) => ({
    version: 1,
    projects: current.projects.filter((entry) => entry.id !== id),
    activeProjectId: current.activeProjectId === id ? null : current.activeProjectId,
  }));
}

export async function setActiveProject(id: string | null): Promise<void> {
  await updateProjects((current) => ({ ...current, activeProjectId: id }));
}

/** 响应式读取（写入即刷新）。 */
export function useProjects(): ProjectsState {
  const [state, setState] = useState(getCachedProjects());
  useEffect(() => subscribeProjects((next) => setState(next)), []);
  return state;
}
