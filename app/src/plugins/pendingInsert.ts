// 面板动作的“插入草稿”跨页传递：面板页没有输入框，写到这里由首页聚焦时取走。
//
// 只存一段文字（≤2000 字，contract 已限制），不落盘；进程结束即丢。

let pending: string | null = null;

export function setPendingInsert(text: string): void {
  pending = text;
}

/** 取走并清空；没有时返回 null。 */
export function takePendingInsert(): string | null {
  const value = pending;
  pending = null;
  return value;
}