// usageStats：会话无关的应用级用量查询——payload 只带 range（strict_keys 只认
// range/timeZone，多带 sessionId 会被内核 -32602 拒掉），时区留给内核自己取。
import { describe, expect, it } from "vitest";

import { KERNEL_METHODS, KernelSessionClient, type KernelTransport } from "../src/index";

class FakeTransport implements KernelTransport {
  readonly sent: string[] = [];
  private readonly listeners = new Set<(line: string) => void>();

  sendLine(line: string): boolean {
    this.sent.push(line);
    return true;
  }

  onLine(listener: (line: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receive(frame: unknown): void {
    const line = JSON.stringify(frame);
    for (const listener of this.listeners) listener(line);
  }

  lastFrame(): Record<string, unknown> {
    const line = this.sent.at(-1);
    if (!line) throw new Error("没有发出任何帧");
    return JSON.parse(line) as Record<string, unknown>;
  }
}

describe("usageStats", () => {
  it("发 v4/usage/stats，不带 sessionId；没建过会话也能查", async () => {
    const transport = new FakeTransport();
    const client = new KernelSessionClient({ transport });

    const pending = client.usageStats("7d");
    expect(transport.lastFrame()).toEqual({
      id: 1,
      method: KERNEL_METHODS.usageStats,
      params: { range: "7d" },
    });

    transport.receive({
      id: 1,
      result: {
        range: "7d",
        generatedAt: 1_763_500_000_000,
        timeZone: "Asia/Shanghai",
        source: "agent-db",
        summary: {
          totalTokens: 12_345,
          inputTokens: 9_000,
          outputTokens: 3_345,
          reasoningTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 4_000,
          cacheHitRate: 0.44,
          totalSessions: 2,
          totalTurns: 5,
          toolCallCount: 3,
          toolErrorRate: 0,
          modelErrorRate: 0,
          avgTimeToFirstTokenMs: null,
          avgTurnDurationMs: null,
          activeDays: 3,
          currentStreakDays: 2,
          longestSessionMs: 0,
          longestStreakDays: 2,
          peakDayTokens: 6_000,
          favoriteModel: { modelId: "test/model", totalTokens: 12_345, share: 1 },
        },
        heatmap: {
          startDate: "2026-11-15",
          endDate: "2026-11-21",
          maxTokens: 6_000,
          weeks: [
            {
              weekIndex: 1,
              days: [
                { date: "2026-11-20", level: 3, totalTokens: 1_200, turnCount: 2, toolCallCount: 1 },
                { date: "2026-11-21", level: 4, totalTokens: 6_000, turnCount: 3, toolCallCount: 2 },
              ],
            },
          ],
        },
        dailyModelUsage: [],
        models: [
          {
            modelId: "test/model",
            totalTokens: 12_345,
            inputTokens: 9_000,
            outputTokens: 3_345,
            requestCount: 5,
            share: 1,
          },
        ],
        tools: [
          {
            toolName: "Bash",
            callCount: 3,
            errorCount: 1,
            errorRate: 1 / 3,
            successRate: 2 / 3,
            errorTypes: { timeout: 1 },
            avgDurationMs: 812.5,
          },
        ],
      },
    });

    const stats = await pending;
    expect(stats.summary.totalTokens).toBe(12_345);
    expect(stats.models[0]?.modelId).toBe("test/model");
    expect(stats.tools[0]?.avgDurationMs).toBeCloseTo(812.5);
  });

  it("range 三档原样透传（all/30d）", async () => {
    const transport = new FakeTransport();
    const client = new KernelSessionClient({ transport });

    const pending = client.usageStats("all");
    expect(transport.lastFrame()).toMatchObject({ method: KERNEL_METHODS.usageStats, params: { range: "all" } });
    transport.receive({ id: 1, result: { range: "all", models: [], tools: [], dailyModelUsage: [] } });
    await pending;

    const pending2 = client.usageStats("30d");
    expect(transport.lastFrame()).toMatchObject({ params: { range: "30d" } });
    transport.receive({ id: 2, result: { range: "30d", models: [], tools: [], dailyModelUsage: [] } });
    await pending2;
  });
});
