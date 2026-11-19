// 按会话 workspace 根的路径口径与接线回归。
//
// 复发点：App 把整个 filesDir 当 workspace 交给内核，所有会话共用 cwd/文件边界；
// 内核又把 create 时的 workspace 持久化，resume 改不了。所以路径必须在 create 前确定，
// 目录名用会话 ID，删除会话时才回收。
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  documentRootOf,
  fileUriOf,
  legacyWorkspaceRef,
  ownedWorkspacePath,
  sessionWorkspacePath,
  sessionWorkspaceRef,
  shouldPruneWorkspaceDir,
} from "../src/kernel/workspace";

const ROOT = "/data/user/0/top.nibistudio.nibigo/files";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("documentRootOf", () => {
  it("file:// 前缀与末尾斜杠都归一掉", () => {
    expect(documentRootOf("file:///data/user/0/p/files/")).toBe("/data/user/0/p/files");
    expect(documentRootOf("file:///data/user/0/p/files")).toBe("/data/user/0/p/files");
    expect(documentRootOf(`${ROOT}/`)).toBe(ROOT);
  });
});

describe("fileUriOf", () => {
  it("Expo 的 Directory 只接受 file:// URI，裸路径要补 scheme", () => {
    expect(fileUriOf(`${ROOT}/workspaces/sess_a`)).toBe(`file://${ROOT}/workspaces/sess_a`);
    expect(fileUriOf(`file://${ROOT}/workspaces/sess_a`)).toBe(
      `file://${ROOT}/workspaces/sess_a`,
    );
  });
});

describe("sessionWorkspaceRef", () => {
  it("按会话 ID 建单层目录", () => {
    expect(sessionWorkspacePath(`${ROOT}/`, "sess_a")).toBe(`${ROOT}/workspaces/sess_a`);
    expect(sessionWorkspaceRef(ROOT, "sess_a")).toEqual({
      workspacePath: `${ROOT}/workspaces/sess_a`,
      workspaceKey: `${ROOT}/workspaces/sess_a`,
    });
  });

  it("拒绝空 ID、. / .. 和路径分隔符", () => {
    for (const id of ["", ".", "..", "a/b", "a\\b"]) {
      expect(() => sessionWorkspacePath(ROOT, id)).toThrow();
    }
  });
});

describe("ownedWorkspacePath", () => {
  it("只认 workspaces/<单个目录名>", () => {
    expect(ownedWorkspacePath(ROOT, `${ROOT}/workspaces/sess_a`)).toBe(
      `${ROOT}/workspaces/sess_a`,
    );
    expect(ownedWorkspacePath(ROOT, `${ROOT}/workspaces/sess_a/`)).toBe(
      `${ROOT}/workspaces/sess_a`,
    );
  });

  it("旧会话根、深层路径与越界路径都不认", () => {
    for (const path of [
      undefined,
      ROOT,
      `${ROOT}/`,
      `${ROOT}/workspaces`,
      `${ROOT}/workspaces/sess_a/nested`,
      `${ROOT}/workspaces/../.nibi`,
      `${ROOT}X/workspaces/sess_a`,
    ]) {
      expect(ownedWorkspacePath(ROOT, path)).toBeNull();
    }
  });

  it("旧会话的 workspace 是 filesDir，永远不在回收范围里", () => {
    const legacy = legacyWorkspaceRef(`${ROOT}/`);
    expect(legacy).toEqual({ workspacePath: ROOT, workspaceKey: ROOT });
    expect(ownedWorkspacePath(ROOT, legacy.workspacePath)).toBeNull();
  });
});

describe("shouldPruneWorkspaceDir", () => {
  it("只清不在会话列表、也不是当前草稿的单段目录", () => {
    const known = new Set(["listed"]);
    expect(shouldPruneWorkspaceDir("orphan", known, "draft")).toBe(true);
    expect(shouldPruneWorkspaceDir("listed", known, "draft")).toBe(false);
    expect(shouldPruneWorkspaceDir("draft", known, "draft")).toBe(false);
    expect(shouldPruneWorkspaceDir("../x", known, "draft")).toBe(false);
  });
});

describe("接线（防回归）", () => {
  it("新会话先用 Host 生成的 ID 建目录，再把同一个 ID 交给内核", () => {
    const hook = source("src/kernel/useKernelConversation.ts");
    expect(hook).toContain("Crypto.randomUUID()");
    expect(hook).toContain("ensureSessionWorkspace(workspaceRoot(), sessionId)");
    expect(hook).toContain("sessionId,");
    // 旧写法会把整个 filesDir 当 workspace 交给内核。
    expect(hook).not.toContain("client.createSession(workspaceRef()");
  });

  it("删除会话在 purge 成功之后才回收 workspace", () => {
    const hook = source("src/kernel/useKernelConversation.ts");
    const purge = hook.indexOf("purgeSessionData([sessionId])");
    const remove = hook.indexOf("removeSessionWorkspace(workspaceRoot(), workspacePath)");
    expect(purge).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(purge);
    // 先确认没被 kept/failed，再删目录（顺序错了会把运行中会话的目录删掉）。
    const kept = hook.indexOf("被引用，暂时不能删除");
    expect(remove).toBeGreaterThan(kept);
    // 临时目录（cacheDir/sessions/<id>）一起回收。
    expect(hook).toContain("removeSessionTempDir(workspaceCacheRoot(), sessionId)");
  });

  it("启动时清理草稿崩溃留下的空目录", () => {
    const hook = source("src/kernel/useKernelConversation.ts");
    expect(hook).toContain("{ pruneWorkspaces: true }");
    expect(hook).toContain("pruneOrphanWorkspaces(");
  });

  it("客户端把显式 sessionId 随 session/create 发出", () => {
    const client = source("../packages/kernel-session/src/client.ts");
    expect(client).toContain("sessionId?: string");
    expect(client).toContain("...(sessionId ? { sessionId } : {})");
  });
});