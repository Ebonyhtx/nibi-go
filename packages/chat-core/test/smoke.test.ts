import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from '../src/index';

// A0 骨架冒烟：纯 TS 层必须 Node 可跑（AGENTS 规则 10）。
// A2 起替换为 V4 事件 fixture 的 reducer 测试（golden 对齐桌面行为，plan.md §5）。
describe('@nibi-go/chat-core（A0 骨架）', () => {
  it('入口可在 Node 环境加载', () => {
    expect(PACKAGE_NAME).toBe('@nibi-go/chat-core');
  });
});
