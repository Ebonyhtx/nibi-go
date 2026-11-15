// 归档会话集合的本地持久化（App 私有 document 目录，JSON）。
//
// 只存会话 ID；标题/时间等仍以 `session/list` 为准。读写失败不阻断界面（最坏情况是本次启动
// 看不到归档记录），但要留下 warn 供排查。
import { File, Paths } from "expo-file-system";

const FILE_NAME = "nibi-archived-sessions.json";

function archiveFile(): File {
  return new File(Paths.document, FILE_NAME);
}

/** 读归档集合；文件不存在/损坏时返回空。 */
export async function loadArchivedSessionIds(): Promise<string[]> {
  try {
    const file = archiveFile();
    if (!file.exists) return [];
    const parsed = JSON.parse(await file.text()) as { archived?: unknown } | null;
    if (!Array.isArray(parsed?.archived)) return [];
    return parsed.archived.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch (error) {
    console.warn("[nibigo] 读取归档会话失败", error);
    return [];
  }
}

/** 写归档集合（整体覆盖）。 */
export async function saveArchivedSessionIds(ids: readonly string[]): Promise<void> {
  try {
    await archiveFile().write(
      `${JSON.stringify({ version: 1, archived: [...new Set(ids)] }, null, 2)}\n`,
    );
  } catch (error) {
    console.warn("[nibigo] 保存归档会话失败", error);
  }
}
