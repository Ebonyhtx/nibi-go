import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from '../src/index';

// A0 骨架冒烟。B0 起替换为接口契约测试（SafetyGate 词表 / confirm 超时拒绝语义）。
describe('@nibi-go/phone-tools（A0 骨架）', () => {
  it('入口可在 Node 环境加载', () => {
    expect(PACKAGE_NAME).toBe('@nibi-go/phone-tools');
  });
});
