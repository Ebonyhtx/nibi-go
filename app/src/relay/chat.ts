// ChatSession——App 侧聊天接线：WorkspaceBridge（A2-5）→ ReplaySession/ConversationStore（chat-core A2-3）。
// 生命周期：transport 进入 paired → start()（bootstrap → 选 workspace → 订阅会话）；
// 连接断开/重连 → teardown()（重配对后重新 bootstrap）。
// A2 限制：会话选择用 bootstrap 的 mobileViewState.activeTaskId（桌面当前视图）；
// 会话列表（sessions-index topic）在 A2 后续切片接入。
import {
  ApprovalBoard,
  ConversationStore,
  ReplaySession,
  type ApprovalDecision,
  type PendingApproval,
  type ReplayDegradeReason,
} from "@nibi-go/chat-core";
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
  /** 在途审批卡（30s 未操作自动拒绝，A3 不变量 2）。 */
  approvals: PendingApproval[];
  error?: string;
}

export class ChatSession {
  /** 消息树状态（UI 用 useSyncExternalStore 订阅）。 */
  readonly store = new ConversationStore();
  private readonly replay: ReplaySession;
  private readonly board: ApprovalBoard;
  /** 连接代次：每次 start/重订阅递增——审批卡绑定代次（A3 不变量 1）。 */
  private epoch = 0;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private bridge?: WorkspaceBridge;
  private subscription?: ConversationSubscription;
  private active?: { sessionId: string; target: BridgeWorkspaceTarget };
  private listeners = new Set<() => void>();
  private snapshot: ChatSnapshot = { phase: "idle", workspaces: [], approvals: [] };

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
    this.board = new ApprovalBoard({
      generation: () => this.epoch,
      onDecision: (request, decision, via) => {
        this.deps.logger?.info("[chat] approval", { id: request.requestId, decision, via });
        void this.subscription?.resolveInteraction(
          request.requestId,
          decision === "allow" ? "accept" : "decline",
        );
        this.update({ approvals: this.board.list() });
      },
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
    // 新连接代次：旧代次审批卡全部作废（A3 不变量 1）
    this.epoch += 1;
    this.board.voidAll();
    this.update({ approvals: [] });
    this.subscription = bridge.conversation(target, sessionId, {
      onFrame: (frame) => this.onFrame(frame),
      onDegraded: (fault) => this.replay.onBridgeDegraded(mapBridgeDegradeReason(fault.reasonCode)),
    });
    await this.subscription.subscribe();
    this.update({ phase: "ready" });
    this.startSweep();
    this.syncInteractions();
  }

  /** 用户作答审批卡（A3）：绑定当前代次；迟到/已作废返回 false。 */
  respondApproval(requestId: string, decision: ApprovalDecision): boolean {
    return this.board.resolve(requestId, decision) === "resolved";
  }

  /** relay data 入口（RelayTransport.onData 转发；桥控制回包与 rpc-frame 都走这里）。 */
  acceptPayload(payload: unknown): void {
    this.bridge?.acceptPayload(payload);
  }

  async sendText(text: string): Promise<void> {
    await this.subscription?.sendText(text);
  }

  teardown(): void {
    this.stopSweep();
    this.epoch += 1;
    this.board.voidAll();
    void this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.bridge?.dispose();
    this.bridge = undefined;
    this.active = undefined;
    this.replay.close();
    this.update({
      phase: "idle",
      sessionId: undefined,
      workspacePath: undefined,
      approvals: [],
      error: undefined,
    });
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
    this.syncInteractions();
  }

  /** 快照 pendingInteractions → 审批板（只接 permission 类；提问卡留后续切片）。 */
  private syncInteractions(): void {
    const snapshot = this.store.snapshot;
    const pending = snapshot?.pendingInteractions ?? [];
    const currentIds = new Set<string>();
    for (const interaction of pending) {
      if (interaction.kind !== "permission") continue;
      currentIds.add(interaction.interactionId);
      const payload = interaction.payload as { summary?: string; toolName?: string };
      this.board.present({
        requestId: interaction.interactionId,
        generation: this.epoch,
        title: payload.summary?.trim() || payload.toolName?.trim() || "工具调用",
      });
    }
    // 快照里已消失的卡（桌面侧已作答/请求撤回）→ 静默对齐
    for (const pendingApproval of this.board.list()) {
      if (!currentIds.has(pendingApproval.requestId)) this.board.drop(pendingApproval.requestId);
    }
    this.update({ approvals: this.board.list() });
  }

  private startSweep(): void {
    this.stopSweep();
    // 30s 默认拒绝由 board.sweep 执行；1s 粒度驱动（不变量 2）
    this.sweepTimer = setInterval(() => {
      if (this.board.sweep() > 0) this.update({ approvals: this.board.list() });
    }, 1_000);
  }

  private stopSweep(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
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
        this.epoch += 1;
        this.board.voidAll();
        this.update({ approvals: [] });
        this.subscription = bridge.conversation(active.target, active.sessionId, {
          onFrame: (frame) => this.onFrame(frame),
          onDegraded: (fault) =>
            this.replay.onBridgeDegraded(mapBridgeDegradeReason(fault.reasonCode)),
        });
        this.replay.begin();
        await this.subscription.subscribe();
        this.update({ phase: "ready" });
        this.startSweep();
        this.syncInteractions();
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
