// 带超时与大小上限的取字节工具（索引与插件包共用）。
import { pickText } from "../i18n";

export const FETCH_TIMEOUT_MS = 20_000;

/** 取一个 URL 的原始字节；只接受 2xx，超时/超限/外部取消都抛错。 */
export async function fetchBytes(
  url: string,
  maxBytes: number,
  options: { timeoutMs?: number; signal?: AbortSignal; cacheBust?: boolean } = {},
): Promise<Uint8Array> {
  // 市场索引/签名必须拿最新字节：RN 的原生 HTTP 缓存可能把旧 index 留到下一次刷新。
  const requestUrl = options.cacheBust
    ? `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`
    : url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const external = options.signal;
  const forwardAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", forwardAbort);
  }
  try {
    const response = await fetch(requestUrl, {
      signal: controller.signal,
      headers: { accept: "application/json, application/octet-stream" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(pickText("响应超过大小上限", "Response exceeds size limit"));
    }
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", forwardAbort);
  }
}

export interface FetchProgressOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** loaded/total（total 未知时为 null）。 */
  onProgress?: (loaded: number, total: number | null) => void;
}

/**
 * 带下载进度的取字节。RN 的 fetch 不暴露进度，这里用 XHR（RN 内置）；
 * 环境没有 XHR（Node 单测）时退回 fetch，只在结束时回调一次。
 */
export async function fetchBytesWithProgress(
  url: string,
  maxBytes: number,
  options: FetchProgressOptions = {},
): Promise<Uint8Array> {
  if (typeof XMLHttpRequest === "undefined") {
    const bytes = await fetchBytes(url, maxBytes, options);
    options.onProgress?.(bytes.byteLength, bytes.byteLength);
    return bytes;
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const timeout = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      xhr.abort();
      finish(() => reject(new Error(pickText("已取消", "Cancelled"))));
    };

    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.timeout = timeout;
    xhr.setRequestHeader("accept", "application/json, application/octet-stream");
    xhr.onprogress = (event) => {
      options.onProgress?.(event.loaded, event.lengthComputable ? event.total : null);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(() => reject(new Error(`HTTP ${xhr.status}`)));
        return;
      }
      const buffer = xhr.response as ArrayBuffer | null;
      if (!buffer) {
        finish(() => reject(new Error(pickText("响应为空", "Empty response"))));
        return;
      }
      if (buffer.byteLength > maxBytes) {
        finish(() => reject(new Error(pickText("响应超过大小上限", "Response exceeds size limit"))));
        return;
      }
      finish(() => resolve(new Uint8Array(buffer)));
    };
    xhr.onerror = () => finish(() => reject(new Error(pickText("网络错误", "Network error"))));
    xhr.ontimeout = () => finish(() => reject(new Error(pickText("下载超时", "Download timed out"))));
    xhr.onabort = () => finish(() => reject(new Error(pickText("已取消", "Cancelled"))));
    options.signal?.addEventListener("abort", onAbort);
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    xhr.send();
  });
}
