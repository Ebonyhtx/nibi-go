import { describe, expect, it } from "vitest";

import { WebRemoteControlV2RetryPolicy, webRemoteControlV2PairState } from "../src/index";

// 手机侧退避参数（relay-v2-pairing.md §05：500ms×2ⁿ 最大 10s，jitter ±20%）
const mobileBackoff = { initialMs: 500, maxMs: 10_000, jitter: 0.2 };

describe("WebRemoteControlV2RetryPolicy", () => {
  it("指数退避带 ±20% jitter，封顶 maxMs", () => {
    const low = new WebRemoteControlV2RetryPolicy(() => 0, mobileBackoff);
    const high = new WebRemoteControlV2RetryPolicy(() => 1, mobileBackoff);
    // random=0 → base×0.8；random=1 → base×1.2
    expect(low.nextDelay()).toBe(400);
    expect(high.nextDelay()).toBe(600);
    expect(low.nextDelay()).toBe(800);
    // 500×2⁵=16000 → 封顶 10000 → 0.8×10000=8000
    for (let i = 0; i < 4; i++) low.nextDelay();
    expect(low.nextDelay()).toBe(8000);
    // high 此前仅调用一次（failures=1 → base=1000）→ 1.2×1000=1200
    expect(high.nextDelay()).toBe(1200);
    // 追加到封顶
    high.nextDelay();
    high.nextDelay();
    high.nextDelay();
    expect(high.nextDelay()).toBe(10000);
  });

  it("auth_ack 清零退避，不清 KICKED 窗口", () => {
    const policy = new WebRemoteControlV2RetryPolicy(() => 0, mobileBackoff);
    policy.nextDelay();
    policy.nextDelay();
    policy.acknowledged();
    expect(policy.nextDelay()).toBe(400);
    expect(policy.kickedDelay(0)).toBe(2000);
    policy.acknowledged();
    expect(policy.kickedDelay(1)).toBeNull();
  });

  it("KICKED 首次随机 2-5s，60s 内第二次 null，出窗后恢复", () => {
    const policy = new WebRemoteControlV2RetryPolicy(() => 0.999, mobileBackoff);
    // 2000 + floor(0.999×3001) = 2000+2997
    expect(policy.kickedDelay(1000)).toBe(4997);
    expect(policy.kickedDelay(2000)).toBeNull();
    expect(policy.kickedDelay(61_000)).toBe(4997);
  });

  it("pair 状态映射 waiting→waiting_terminal / matched→paired", () => {
    expect(webRemoteControlV2PairState("waiting")).toBe("waiting_terminal");
    expect(webRemoteControlV2PairState("matched")).toBe("paired");
  });
});
