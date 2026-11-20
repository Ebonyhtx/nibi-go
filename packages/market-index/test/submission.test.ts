import { describe, expect, it } from "vitest";

import {
  applySubmission,
  MARKET_RAW_PREFIX,
  packageFileFor,
  submissionSchema,
  type PluginSubmission,
} from "../src/submission";
import type { MarketIndex } from "../src/types";

const SHA = "a".repeat(64);

function submission(overrides: Partial<PluginSubmission> = {}): PluginSubmission {
  return {
    schemaVersion: 1,
    id: "com.example.demo",
    name: "Demo",
    version: "1.0.0",
    description: "演示插件",
    license: "MIT",
    contact: "mailto:dev@example.com",
    publisher: { name: "Demo Author", github: "demo-author" },
    caps: ["mcp.v1"],
    runtime: "node",
    package: { file: packageFileFor("com.example.demo", "1.0.0"), sha256: SHA, size: 1234 },
    ...overrides,
  };
}

function emptyIndex(): MarketIndex {
  return {
    schemaVersion: 1,
    market: "nibi-official",
    revision: 5,
    generatedAt: "2026-01-01T00:00:00.000Z",
    plugins: [],
  };
}

describe("submissionSchema", () => {
  it("接受合法提交", () => {
    expect(submissionSchema.safeParse(submission()).success).toBe(true);
  });

  it("拒绝 paid / UNLICENSED 之外的未知字段不拦，但 paid 明确拒绝", () => {
    expect(submissionSchema.safeParse({ ...submission(), paid: true }).success).toBe(false);
  });

  it("caps 必须是数组、package.size 必须为正", () => {
    expect(submissionSchema.safeParse({ ...submission(), caps: "mcp.v1" }).success).toBe(false);
    expect(
      submissionSchema.safeParse({ ...submission(), package: { ...submission().package, size: 0 } })
        .success,
    ).toBe(false);
  });
});

describe("applySubmission", () => {
  it("新插件合并后 revision +1，包地址指向市场仓 raw", () => {
    const result = applySubmission(emptyIndex(), submission(), "2026-02-02T00:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unchanged).toBe(false);
    expect(result.index.revision).toBe(6);
    expect(result.index.generatedAt).toBe("2026-02-02T00:00:00.000Z");
    expect(result.entry.package.url).toBe(
      `${MARKET_RAW_PREFIX}packages/com.example.demo-1.0.0.zip`,
    );
    expect(result.entry.license).toBe("MIT");
    expect(result.entry.publisher).toBe("Demo Author");
    expect(result.entry.publisherGithub).toBe("demo-author");
    expect(result.index.plugins).toHaveLength(1);
  });

  it("同版本同摘要视为未变化（不升 revision）", () => {
    const first = applySubmission(emptyIndex(), submission());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applySubmission(first.index, submission());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.unchanged).toBe(true);
    expect(second.index.revision).toBe(first.index.revision);
  });

  it("同版本换摘要被拒绝", () => {
    const first = applySubmission(emptyIndex(), submission());
    if (!first.ok) return;
    const changed = submission({ package: { ...submission().package, sha256: "b".repeat(64) } });
    expect(applySubmission(first.index, changed)).toMatchObject({ ok: false });
  });

  it("版本倒退被拒绝", () => {
    const first = applySubmission(
      emptyIndex(),
      submission({
        version: "1.2.0",
        publisher: { name: "Demo Author", github: "demo-author" },
      }),
    );
    if (!first.ok) return;
    const older = submission({
      version: "1.1.0",
      package: { file: packageFileFor("com.example.demo", "1.1.0"), sha256: SHA, size: 1234 },
    });
    expect(applySubmission(first.index, older)).toMatchObject({ ok: false });
  });

  it("包文件名与 id/version 不一致被拒绝", () => {
    const bad = submission({
      package: { file: "packages/other-1.0.0.zip", sha256: SHA, size: 1234 },
    });
    expect(applySubmission(emptyIndex(), bad)).toMatchObject({ ok: false });
  });

  it("升级版本会替换原条目", () => {
    const first = applySubmission(emptyIndex(), submission());
    if (!first.ok) return;
    const next = submission({
      version: "1.0.1",
      package: { file: packageFileFor("com.example.demo", "1.0.1"), sha256: "c".repeat(64), size: 2048 },
    });
    const result = applySubmission(first.index, next);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.index.plugins).toHaveLength(1);
    expect(result.index.plugins[0]?.version).toBe("1.0.1");
  });
});
