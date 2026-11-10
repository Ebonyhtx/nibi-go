// 来源: nibi-client@ff1c5f4f packages/shared/src/web-remote-control.ts 行 114-204（局部抽取，未改写语义）
// 抽取范围: V2 二维码契约——WebRemoteControlV2QrParams + build/parse 两个函数（D7：QR 只承载路由提示）。
// 该段自包含（无外部 import）；web-remote-control.ts 其余部分（App payload 全表等）A2 按需抽取。
export interface WebRemoteControlV2QrParams {
  deviceSid?: string;
  deviceMid?: string;
  deviceName?: string;
  appVersion?: string;
}

export type BuildWebRemoteControlExternalQrUrlOptions = WebRemoteControlV2QrParams & {
  baseUrl: string;
};

function readNonEmptySearchParam(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)?.trim();
  return value ? value : undefined;
}

export function buildWebRemoteControlExternalQrUrl({
  baseUrl,
  deviceSid,
  deviceMid,
  deviceName,
  appVersion,
}: BuildWebRemoteControlExternalQrUrlOptions): string {
  const url = new URL(baseUrl);
  if (deviceSid !== undefined) url.searchParams.set("sid", deviceSid);
  // 旧凭据只允许清除，不能从 base URL 重新带入新二维码。
  url.searchParams.delete("hash");
  url.searchParams.delete("t");

  if (deviceMid?.trim()) {
    url.searchParams.set("mid", deviceMid);
  }
  if (deviceName?.trim()) {
    url.searchParams.set("name", deviceName);
  }
  if (appVersion?.trim()) {
    url.searchParams.set("app_version", appVersion);
  }
  return url.toString();
}

export function parseWebRemoteControlExternalQrParams(
  params: URLSearchParams,
): WebRemoteControlV2QrParams | null {
  if (params.has("hash") || params.has("t")) return null;
  const result: WebRemoteControlV2QrParams = {};
  for (const [key, param] of [
    ["deviceSid", "sid"],
    ["deviceMid", "mid"],
    ["deviceName", "name"],
    ["appVersion", "app_version"],
  ] as const) {
    const value = readNonEmptySearchParam(params, param);
    if (value) result[key] = value;
  }
  return result;
}
