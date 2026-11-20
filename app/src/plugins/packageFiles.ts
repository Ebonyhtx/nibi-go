// 插件 zip 的纯逻辑校验：路径安全、体积/数量上限、根目录清单。
// 不依赖 expo/RN，Node 侧可单测；解包与落盘在 installer.ts。

export const MANIFEST_FILE = "nibi-go.plugin.json";

const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PATH_LENGTH = 200;
const MAX_DEPTH = 8;

export interface ArchiveFile {
  /** zip 内的相对路径（`/` 分隔，已通过安全校验）。 */
  path: string;
  bytes: Uint8Array;
}

export type ArchiveInspection =
  | { ok: true; files: ArchiveFile[]; manifestText: string }
  | { ok: false; reason: string };

/** 拒绝绝对路径、`..`、反斜杠、控制字符与过深的路径。 */
export function isSafeArchivePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (path.startsWith("/") || /^[A-Za-z]:/u.test(path)) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (/[\u0000-\u001f\u007f]/u.test(path)) return false;
  const segments = path.split("/");
  if (segments.length > MAX_DEPTH) return false;
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function inspectPluginArchive(entries: Record<string, Uint8Array>): ArchiveInspection {
  const files: ArchiveFile[] = [];
  let total = 0;
  for (const [rawPath, bytes] of Object.entries(entries)) {
    // 目录条目（以 / 结尾）没有内容，忽略。
    if (rawPath.endsWith("/")) continue;
    if (!isSafeArchivePath(rawPath)) {
      return { ok: false, reason: `包内路径不安全：${rawPath.slice(0, 80)}` };
    }
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return { ok: false, reason: `单个文件过大：${rawPath}` };
    }
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) return { ok: false, reason: "包解压后超过 32 MiB" };
    if (files.length >= MAX_FILES) return { ok: false, reason: "包内文件数超过 500" };
    files.push({ path: rawPath, bytes });
  }
  const manifest = files.find((file) => file.path === MANIFEST_FILE);
  if (!manifest) return { ok: false, reason: `包根目录缺少 ${MANIFEST_FILE}` };
  return {
    ok: true,
    files,
    manifestText: new TextDecoder().decode(manifest.bytes),
  };
}
