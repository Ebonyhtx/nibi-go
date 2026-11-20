// 本机记忆的体量与清理（复用内核 `sessionData/measure|purge`）。
//
// GO 的内核进程 cwd 是 `/`，自动记忆目录由 workspace 根 `/` 推出，所以所有会话共享
// 一份 `project-<hash>/memory`。这里同时探测 `/` 与当前会话 workspace，避免内核
// 未来改成按会话 workspace 时漏掉；只展示实际有字节的目录。

import { KERNEL_METHODS, type KernelSessionClient } from "@nibi-go/kernel-session";

export interface MemoryUsageEntry {
  workspacePath: string;
  bytes: number;
}

interface MeasureResult {
  memory?: MemoryUsageEntry[];
}

async function candidateWorkspaces(client: KernelSessionClient): Promise<string[]> {
  const paths = new Set<string>(["/"]);
  try {
    const list = await client.listSessions();
    const current = list.find((item) => item.sessionId === client.currentSessionId);
    const workspace = current?.workspace?.workspacePath;
    if (typeof workspace === "string" && workspace) paths.add(workspace);
  } catch {
    // 会话列表不可用时只探测 `/`；measure 本身仍会给出结果。
  }
  return [...paths];
}

export async function measureMemory(
  client: KernelSessionClient,
): Promise<{ entries: MemoryUsageEntry[]; totalBytes: number; workspaces: string[] }> {
  const workspaces = await candidateWorkspaces(client);
  const result = await client.request<MeasureResult>(KERNEL_METHODS.sessionDataMeasure, {
    sessionIds: [],
    directories: workspaces.map((workspacePath) => ({ workspacePath })),
  });
  const entries = (result.memory ?? []).filter((entry) => entry.bytes > 0);
  return {
    entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    workspaces,
  };
}

/**
 * 清空本机记忆（整棵 `memories/projects/<slug>-<hash>` 目录）。
 * 已打开的会话仍持有内存里的 MEMORY.md，重新打开或压缩后才会消失。
 */
export async function clearMemory(client: KernelSessionClient): Promise<number> {
  const workspaces = await candidateWorkspaces(client);
  const result = await client.purgeSessionData(
    [],
    workspaces.map((workspacePath) => ({ workspacePath })),
  );
  return result.deleted.reduce((sum, item) => sum + item.bytes, 0);
}
