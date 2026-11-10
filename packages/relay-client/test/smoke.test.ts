import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from '../src/index';

// A0 骨架冒烟：纯 TS 层必须 Node 可跑（AGENTS 规则 10）。
// A1 起替换为 fake-relay-v2 契约测试（草案 §4：注册/配对/心跳/顶踢/错误码）。
describe('@nibi-go/relay-client（A0 骨架）', () => {
  it('入口可在 Node 环境加载', () => {
    expect(PACKAGE_NAME).toBe('@nibi-go/relay-client');
  });
});
