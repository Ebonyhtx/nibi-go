// 带超时与大小上限的取字节工具（索引与插件包共用）。
export const FETCH_TIMEOUT_MS = 20_000;

/** 取一个 URL 的原始字节；只接受 2xx，超时/超限都抛错。 */
export async function fetchBytes(url: string, maxBytes: number, timeoutMs = FETCH_TIMEOUT_MS): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json, application/octet-stream" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new Error("响应超过大小上限");
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timer);
  }
}
