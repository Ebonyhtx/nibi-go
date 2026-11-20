// 当前内核会话客户端的只读访问点。
//
// 首页的 useKernelConversation 是唯一创建 client 的地方；设置里的诊断/记忆页需要
// 复用同一条连接（另建 client 会和首页抢内核通道、重复订阅）。这里只登记引用，
// 不持有生命周期：client 关闭/内核重启时由创建方注销。

import type { KernelSessionClient } from "@nibi-go/kernel-session";

let current: KernelSessionClient | null = null;

export function registerKernelClient(client: KernelSessionClient): void {
  current = client;
}

export function unregisterKernelClient(client: KernelSessionClient): void {
  if (current === client) current = null;
}

export function currentKernelClient(): KernelSessionClient | null {
  return current;
}
