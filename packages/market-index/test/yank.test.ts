import { describe, expect, it } from "vitest";

import type { MarketIndex, MarketPluginEntry } from "../src/types";
import {
  applyYank,
  checkYankLog,
  emptyYankLog,
  parseYankLog,
  yankLogSchema,
  type YankLog,
} from "../src/yank";

const SHA = "a".repeat(64);
const NOW = "2026-03-03T00:00:00.000Z";

function entry(id: string, version: string): MarketPluginEntry {
  return {
    id,
    name: `插件 ${id}`,
    version,
    caps: ["mcp.v1"],
    package: {
      url: `https://raw.githubusercontent.com/Ebonyhtx/nibi-go-market/main/packages/${id}-${version}.zip`,
      sha256: SHA,
      size: 100,
      format: "zip",
    },
  };
}

function index(plugins: MarketPluginEntry[], revision = 5): MarketIndex {
  return {
    schemaVersion: 1,
    market: "nibi-official",
    revision,
    generatedAt: "2026-01-01T00:00:00.000Z",
    plugins,
  };
}

function log(...entries: YankLog["entries"]): YankLog {
  return { schemaVersion: 1, entries };
}

describe("applyYank", () => {
  it("移除条目、revision +1，并给出对应 revision 的记录", () => {
    const result = applyYank(index([entry("com.example.a", "1.0.0")]), {
      id: "com.example.a",
      reason: "安全扫描发现下载执行",
    }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.index.revision).toBe(6);
    expect(result.index.plugins).toHaveLength(0);
    expect(result.index.generatedAt).toBe(NOW);
    expect(result.record).toEqual({
      id: "com.example.a",
      version: "1.0.0",
      reason: "安全扫描发现下载执行",
      yankedAt: NOW,
      revision: 6,
    });
  });

  it("只移除目标条目，其它条目原样保留", () => {
    const result = applyYank(
      index([entry("com.example.a", "1.0.0"), entry("com.example.b", "2.0.0")]),
      { id: "com.example.a", reason: "违规" },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.index.plugins.map((plugin) => plugin.id)).toEqual(["com.example.b"]);
  });

  it("指定版本不一致时拒绝（防止撤回错版本）", () => {
    const result = applyYank(index([entry("com.example.a", "1.1.0")]), {
      id: "com.example.a",
      version: "1.0.0",
      reason: "违规",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("版本不一致");
  });

  it("未知 id、空理由都拒绝", () => {
    expect(applyYank(index([]), { id: "com.example.a", reason: "违规" }).ok).toBe(false);
    expect(applyYank(index([entry("com.example.a", "1.0.0")]), { id: "com.example.a", reason: " " }).ok).toBe(
      false,
    );
  });

  it("理由超过 500 字拒绝", () => {
    const result = applyYank(index([entry("com.example.a", "1.0.0")]), {
      id: "com.example.a",
      reason: "长".repeat(501),
    });
    expect(result.ok).toBe(false);
  });
});

describe("yankLogSchema / parseYankLog", () => {
  it("合法记录通过，空记录合法", () => {
    expect(parseYankLog(emptyYankLog())).not.toBeNull();
    expect(
      parseYankLog(
        log({ id: "com.example.a", version: "1.0.0", reason: "违规", yankedAt: NOW, revision: 6 }),
      ),
    ).not.toBeNull();
  });

  it("拒绝坏 id/版本/空理由", () => {
    expect(
      yankLogSchema.safeParse(
        log({ id: "Bad Id", version: "1.0.0", reason: "违规", yankedAt: NOW, revision: 6 }),
      ).success,
    ).toBe(false);
    expect(
      yankLogSchema.safeParse(
        log({ id: "com.example.a", version: "v1", reason: "违规", yankedAt: NOW, revision: 6 }),
      ).success,
    ).toBe(false);
    expect(
      yankLogSchema.safeParse(
        log({ id: "com.example.a", version: "1.0.0", reason: "", yankedAt: NOW, revision: 6 }),
      ).success,
    ).toBe(false);
  });

  it("非对象/缺字段返回 null", () => {
    expect(parseYankLog(null)).toBeNull();
    expect(parseYankLog({ schemaVersion: 2, entries: [] })).toBeNull();
    expect(parseYankLog({ schemaVersion: 1 })).toBeNull();
  });
});

describe("checkYankLog", () => {
  it("撤回记录与当前索引不冲突时通过", () => {
    const problems = checkYankLog(
      log({ id: "com.example.a", version: "1.0.0", reason: "违规", yankedAt: NOW, revision: 6 }),
      index([]),
    );
    expect(problems).toEqual([]);
  });

  it("当前索引仍是被撤回的版本时报错", () => {
    const problems = checkYankLog(
      log({ id: "com.example.a", version: "1.0.0", reason: "违规", yankedAt: NOW, revision: 6 }),
      index([entry("com.example.a", "1.0.0")]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("仍是这个版本");
  });

  it("撤回后以更高版本回归是合法的", () => {
    const problems = checkYankLog(
      log({ id: "com.example.a", version: "1.0.0", reason: "违规", yankedAt: NOW, revision: 6 }),
      index([entry("com.example.a", "1.0.1")]),
    );
    expect(problems).toEqual([]);
  });

  it("同 (id, version) 重复撤回报错", () => {
    const record = { id: "com.example.a", version: "1.0.0", reason: "违规", yankedAt: NOW, revision: 6 };
    const problems = checkYankLog(log(record, { ...record, revision: 7 }), index([]));
    expect(problems.some((problem) => problem.message.includes("重复撤回"))).toBe(true);
  });

  it("revision 不递增报错", () => {
    const problems = checkYankLog(
      log(
        { id: "com.example.a", version: "1.0.0", reason: "违规", yankedAt: NOW, revision: 7 },
        { id: "com.example.b", version: "1.0.0", reason: "违规", yankedAt: NOW, revision: 6 },
      ),
      index([]),
    );
    expect(problems.some((problem) => problem.message.includes("不是递增"))).toBe(true);
  });
});
