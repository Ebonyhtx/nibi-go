// ChatSession——App 侧聊天接线：WorkspaceBridge（A2-5）→ ReplaySession/ConversationStore（chat-core A2-3）。
// 生命周期：transport 进入 paired → start()（bootstrap → 选 workspace → 订阅会话）；
// 连接断开/重连 → teardown()（重配对后重新 bootstrap）。
// A2 限制：会话选择用 bootstrap 的 mobileViewState.activeTaskId（桌面当前视图）；
// 会话列表（sessions-index topic）在 A2 后续切片接入。
import { ConversationStore, ReplaySession, type ReplayDegradeReason } from "@nibi-go/chat-core";
import {
  ConversationSubscription,
  WorkspaceBridge,
  type BridgeBootstrapResult,
  type BridgeWorkspaceTarget,
  type RelayJson,
} from "@nibi-go/relay-client";
import type { ConversationTopicFrame } from "@nibi-go/shared-extract";

export type ChatPhase =
  | "idle"
  | "bootstrapping"
  | "opening-workspace"
  | "subscribing"
  | "ready"
  | "resyncing"
  | "error";

export interface ChatSnapshot {
  phase: ChatPhase;
  sessionId?: string;
  workspacePath?: string;
  workspaces: Array<{ workspacePath: string; label?: string }>;
  error?: string;
}

export class ChatSession {
  /** 消息树状态（UI 用 useSyncExternalStore 订阅）。 */
  readonly store = new ConversationStore();
  private readonly replay: ReplaySession;
  private bridge?: WorkspaceBridge;
  private subscription?: ConversationSubscription;
  private active?: { sessionId: string; target: BridgeWorkspaceTarget };
  private listeners = new Set<() => void>();
  private snapshot: ChatSnapshot = { phase: "idle", workspaces: [] };

  constructor(
    private readonly deps: {
      /** 发送 relay data（转发到当前 RelayTransport.sendData）。 */
      send(payload: RelayJson): boolean;
      logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
    },
  ) {
    this.replay = new ReplaySession(this.store, {
      onResyncNeeded: (reason) => this.handleResync(reason),
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ChatSnapshot => this.snapshot;

  private update(patch: Partial<ChatSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** 连接配对成功：bootstrap → 打开 workspace → 订阅桌面当前会话。 */
  async start(): Promise<void> {
    this.teardown();
    this.update({ phase: "bootstrapping", error: undefined, workspaces: [] });
    try {
      this.bridge = new WorkspaceBridge({
        send: this.deps.send,
        logger: this.deps.logger,
      });
      this.bridge.onDegraded((event) => {
        this.replay.onBridgeDegraded(
          mapBridgeDegradeReason(event.reasonCode),
        );
      });
      const bootstrap = await this.bridge.bootstrap();
      this.update({
        workspaces: bootstrap.workspaces.map((w) => ({
          workspacePath: w.workspacePath,
          label: w.label,
        })),
      });
      const selection = this.pickTarget(bootstrap);
      if (!selection) throw new Error("桌面未指定当前会话（请在桌面打开一个任务后重连）");
      await this.openAndSubscribe(selection.workspacePath, selection.sessionId);
    } catch (error) {
      this.update({
        phase: "error",
        error: error instanceof Error ? error.message : "桥接失败",
      });
    }
  }

  /** 手动切换会话（A2 后续切片：会话列表 UI 调用）。 */
  async openAndSubscribe(workspacePath: string, sessionId: string): Promise<void> {
    const bridge = this.bridge;
    if (!bridge) throw new Error("bridge is not bootstrapped");
    this.update({ phase: "opening-workspace", sessionId, workspacePath });
    const info = await bridge.openWorkspace({ workspaceKey: workspacePath });
    const target: BridgeWorkspaceTarget = {
      workspacePath: info.workspacePath,
      ...(info.workspaceIdentity ? { workspaceIdentity: info.workspaceIdentity } : {}),
      ...(info.remoteSessionId ? { remoteSessionId: info.remoteSessionId } : {}),
    };
    this.active = { sessionId, target };
    this.update({ phase: "subscribing" });
    this.replay.begin();
    this.subscription = bridge.conversation(target, sessionId, {
      onFrame: (frame) => this.onFrame(frame),
      onDegraded: (fault) => this.replay.onBridgeDegraded(mapBridgeDegradeReason(fault.reasonCode)),
    });
    await this.subscription.subscribe();
    this.update({ phase: "ready" });
  }

  /** relay data 入口（RelayTransport.onData 转发；桥控制回包与 rpc-frame 都走这里）。 */
  acceptPayload(payload: unknown): void {
    this.bridge?.acceptPayload(payload);
  }

  async sendText(text: string): Promise<void> {
    await this.subscription?.sendText(text);
  }

  teardown(): void {
    void this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.bridge?.dispose();
    this.bridge = undefined;
    this.active = undefined;
    this.replay.close();
    this.update({ phase: "idle", sessionId: undefined, workspacePath: undefined, error: undefined });
  }

  private pickTarget(
    bootstrap: BridgeBootstrapResult,
  ): { workspacePath: string; sessionId: string } | undefined {
    const viewState = bootstrap.mobileViewState ?? bootstrap.initialViewState;
    const sessionId = viewState?.activeTaskId;
    if (!sessionId) return undefined;
    const workspaceKey = viewState?.activeWorkspaceKey;
    const workspace =
      (workspaceKey
        ? bootstrap.workspaces.find(
            (w) => (w.workspaceIdentity ?? w.workspacePath) === workspaceKey,
          )
        : undefined) ?? bootstrap.workspaces[0];
    if (!workspace) return undefined;
    return { workspacePath: workspace.workspacePath, sessionId };
  }

  private onFrame(frame: ConversationTopicFrame): void {
    if (frame.payload.kind === "snapshot") {
      this.replay.onSnapshot(frame.payload.snapshot);
    } else {
      this.replay.onDeltas(frame.payload.deltas);
    }
  }

  private handleResync(reason: ReplayDegradeReason): void {
    const active = this.active;
    const bridge = this.bridge;
    this.update({ phase: "resyncing" });
    this.deps.logger?.warn("[chat] resync", { reason });
    if (!active || !bridge) return;
    void (async () => {
      try {
        await this.subscription?.unsubscribe();
        this.subscription = bridge.conversation(active.target, active.sessionId, {
          onFrame: (frame) => this.onFrame(frame),
          onDegraded: (fault) =>
            this.replay.onBridgeDegraded(mapBridgeDegradeReason(fault.reasonCode)),
        });
        this.replay.begin();
        await this.subscription.subscribe();
        this.update({ phase: "ready" });
      } catch (error) {
        this.update({
          phase: "error",
          error: error instanceof Error ? error.message : "会话重同步失败",
        });
      }
    })();
  }
}

/** bridge/rpc 降级 reason → replay 五类（未知按帧缺口处理，走 resync）。 */
function mapBridgeDegradeReason(reasonCode: string): ReplayDegradeReason {
  switch (reasonCode) {
    case "rpc-transport-fault":
    case "rpc-frame-gap":
    case "buffer-overflow":
    case "buffer-timeout":
    case "source-session-replaced":
      return reasonCode;
    default:
      return "rpc-frame-gap";
  }
}
