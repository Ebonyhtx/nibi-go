import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from '../src/index';

// A0 骨架冒烟。A1 首次抽取后，此文件替换为抽取件的契约用例
// （fake-relay-v2 夹具跑通即绿——AGENTS 规则 11）。
describe('@nibi-go/shared-extract（A0 骨架）', () => {
  it('入口可在 Node 环境加载', () => {
    expect(PACKAGE_NAME).toBe('@nibi-go/shared-extract');
  });
});
