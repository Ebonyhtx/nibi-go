// 按会话 workspace 根的路径口径（纯函数；文件系统操作在 workspaceStore.ts）。
//
// 内核把 `session/create` 的 workspace 持久化为该会话唯一的工作区：文件工具、shell cwd
// 与路径策略都以它为边界，`session/resume` 不会改它。所以根目录名用会话 ID：创建前就能
// 确定路径，删除会话时也能确定地回收。旧会话（workspace 就是 filesDir）保持原样，不迁移。

/** 与内核 `KernelWorkspaceRef` 同形；这里不依赖包类型，方便单测。 */
export interface WorkspaceRefLike {
  workspacePath: string;
  workspaceKey: string;
}

export const WORKSPACES_DIR = "workspaces";

/** Expo 的 document URI（file:///…/files/）→ 内核要的绝对路径，去掉末尾斜杠。 */
export function documentRootOf(uri: string): string {
  return uri.replace(/^file:\/\//u, "").replace(/\/+$/u, "");
}

/** Expo FileSystem 的 Directory/File 只接受 `file://` URI；内核要的是裸路径。 */
export function fileUriOf(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}

/** 会话 ID 会拼进路径：只接受单段名字（UUID / 内核 sess_… 都满足）。 */
export function isSafeSessionId(sessionId: string): boolean {
  return (
    sessionId.length > 0 &&
    sessionId !== "." &&
    sessionId !== ".." &&
    !sessionId.includes("/") &&
    !sessionId.includes("\\")
  );
}

export function sessionWorkspacePath(root: string, sessionId: string): string {
  if (!isSafeSessionId(sessionId)) {
    throw new Error(`非法的会话 ID：${sessionId}`);
  }
  return `${root.replace(/\/+$/u, "")}/${WORKSPACES_DIR}/${sessionId}`;
}

export function sessionWorkspaceRef(root: string, sessionId: string): WorkspaceRefLike {
  const workspacePath = sessionWorkspacePath(root, sessionId);
  return { workspacePath, workspaceKey: workspacePath };
}

/** 旧会话的工作区就是 filesDir 本身；内核里已经持久化，恢复时不能改。 */
export function legacyWorkspaceRef(root: string): WorkspaceRefLike {
  const workspacePath = root.replace(/\/+$/u, "");
  return { workspacePath, workspaceKey: workspacePath };
}

export const PROJECTS_DIR = "projects";

/** 项目的持久 workspace：`<root>/projects/<projectId>`。多个会话共享同一目录。 */
export function projectWorkspacePath(root: string, projectId: string): string {
  if (!isSafeProjectDirName(projectId)) {
    throw new Error(`非法的项目 ID：${projectId}`);
  }
  return `${root.replace(/\/+$/u, "")}/${PROJECTS_DIR}/${projectId}`;
}

export function projectWorkspaceRef(root: string, projectId: string): WorkspaceRefLike {
  const workspacePath = projectWorkspacePath(root, projectId);
  return { workspacePath, workspaceKey: workspacePath };
}

/** 项目 id 同时是目录名：与 projects.ts 的 isSafeProjectId 同一条规则（这里不 import 避免循环）。 */
function isSafeProjectDirName(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);
}

/** 这个 workspace 属于哪个项目（按 `<root>/projects/<id>` 前缀反查）；不属于任何项目返回 null。 */
export function projectIdOfWorkspace(
  root: string,
  workspacePath: string | undefined | null,
): string | null {
  if (!workspacePath) return null;
  const prefix = `${root.replace(/\/+$/u, "")}/${PROJECTS_DIR}/`;
  const normalized = workspacePath.replace(/\/+$/u, "");
  if (!normalized.startsWith(prefix)) return null;
  const name = normalized.slice(prefix.length);
  return isSafeProjectDirName(name) ? name : null;
}

/**
 * 只认 `<root>/workspaces/<单个目录名>`。
 *
 * 旧会话（root 本身）、更深路径、带 `..` 或别处前缀的路径一律不认——删除会话时拿它当
 * 清理前的护栏，避免误删内核数据（.nibi）、插件目录或用户直接放在 filesDir 的文件。
 */
export function ownedWorkspacePath(
  root: string,
  workspacePath: string | undefined | null,
): string | null {
  if (!workspacePath) return null;
  const prefix = `${root.replace(/\/+$/u, "")}/${WORKSPACES_DIR}/`;
  const normalized = workspacePath.replace(/\/+$/u, "");
  if (!normalized.startsWith(prefix)) return null;
  const name = normalized.slice(prefix.length);
  if (!isSafeSessionId(name)) return null;
  return normalized;
}

/**
 * 启动清理：目录名不对应任何已知会话（草稿崩溃留下的）才考虑删。
 * 是否为空由调用方检查——非空目录可能是用户数据，不在这里删。
 */
export function shouldPruneWorkspaceDir(
  name: string,
  knownSessionIds: ReadonlySet<string>,
  activeSessionId?: string | null,
): boolean {
  return isSafeSessionId(name) && name !== activeSessionId && !knownSessionIds.has(name);
}
