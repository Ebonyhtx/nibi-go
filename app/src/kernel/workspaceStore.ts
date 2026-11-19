// 按会话 workspace 的磁盘操作（Expo FileSystem）。路径口径见 workspace.ts。
//
// 目录约定：`<filesDir>/workspaces/<sessionId>/`。创建在 session/create 之前完成，
// 因为内核会把 workspace 持久化并据此设置 cwd/路径策略；删除只有在会话彻底 purged
// 成功之后才做（见 useKernelConversation.deleteSession）。

import { Directory } from "expo-file-system";

import {
  WORKSPACES_DIR,
  fileUriOf,
  isSafeSessionId,
  ownedWorkspacePath,
  sessionWorkspacePath,
  sessionWorkspaceRef,
  shouldPruneWorkspaceDir,
  type WorkspaceRefLike,
} from "./workspace";

function workspacesRoot(root: string): string {
  return `${root.replace(/\/+$/u, "")}/${WORKSPACES_DIR}`;
}

/**
 * Expo 的 Directory 只接受 `file://` URI（原生 JavaFile 用 `File(URI)`，裸路径会抛
 * "URI scheme is not file"）。内核要的是裸路径，这里只在进 Expo API 前补 scheme。
 */
function directoryAt(path: string): Directory {
  return new Directory(fileUriOf(path));
}

/** 建会话前准备目录；已存在时幂等。 */
export function ensureSessionWorkspace(root: string, sessionId: string): WorkspaceRefLike {
  const dir = directoryAt(sessionWorkspacePath(root, sessionId));
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return sessionWorkspaceRef(root, sessionId);
}

/**
 * 回收会话的 workspace。返回是否真的删了一个目录。
 * 旧会话（root 本身）与不在 `<root>/workspaces/` 下的路径永不删。
 */
export function removeSessionWorkspace(root: string, workspacePath: string | undefined | null): boolean {
  const owned = ownedWorkspacePath(root, workspacePath);
  if (!owned) return false;
  const dir = directoryAt(owned);
  if (!dir.exists) return false;
  dir.delete();
  return true;
}

/**
 * 会话的临时目录（`<cacheRoot>/sessions/<sessionId>`，内核按 NIBI_SESSION_TMP_ROOT 使用）。
 * 删会话时一起回收；缓存本身不持久，系统清理也不影响会话。
 */
export function removeSessionTempDir(cacheRoot: string, sessionId: string): boolean {
  if (!isSafeSessionId(sessionId)) return false;
  const dir = directoryAt(`${cacheRoot.replace(/\/+$/u, "")}/sessions/${sessionId}`);
  if (!dir.exists) return false;
  dir.delete();
  return true;
}

/**
 * 清掉草稿会话崩溃后留下的空目录（不认识的会话 ID 且目录为空）。
 * 非空目录保留：可能是用户数据。返回删除数量。
 */
export function pruneOrphanWorkspaces(
  root: string,
  knownSessionIds: ReadonlySet<string>,
  activeSessionId?: string | null,
): number {
  const dir = directoryAt(workspacesRoot(root));
  if (!dir.exists) return 0;
  let removed = 0;
  for (const entry of dir.list()) {
    if (!(entry instanceof Directory)) continue;
    if (!shouldPruneWorkspaceDir(entry.name, knownSessionIds, activeSessionId)) continue;
    try {
      if (entry.list().length > 0) continue;
      entry.delete();
      removed += 1;
    } catch {
      // 目录正被占用/权限异常：下次启动再试，不影响首页。
    }
  }
  return removed;
}