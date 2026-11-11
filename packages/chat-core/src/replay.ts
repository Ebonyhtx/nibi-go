// replay：手机 web-remote-replayable 的 snapshot/gap 恢复边界（relay-v2-pairing.md 语义）。
// 边界纪律：
//   - 只有处于 streaming（已对齐某份快照水位）时才应用 delta——半截状态绝不落库；
//   - bridge 降级（rpc-transport-fault / rpc-frame-gap / buffer-* / source-session-replaced）
//     → resyncing，由上层重新走 bootstrap 取新快照；
//   - 新快照到达后 replaceSnapshot 并恢复 streaming。
import type { ConversationDelta, ConversationSnapshot } from "@nibi-go/shared-extract";

import type { ConversationStore } from "./state";

export type ReplayState = "idle" | "awaiting-snapshot" | "streaming" | "resyncing";

/** 与上游 bridge-degraded reason 枚举一致（WebRemoteControlBridgeDegradedPayload）。 */
export type ReplayDegradeReason =
  | "rpc-transport-fault"
  | "rpc-frame-gap"
  | "buffer-overflow"
  | "buffer-timeout"
  | "source-session-replaced";

export interface ReplaySessionOptions {
  /** 进入 resyncing 时回调（上层重新 bootstrap 取快照）。 */
  onResyncNeeded(reason: ReplayDegradeReason): void;
}

export class ReplaySession {
  private current: ReplayState = "idle";

  constructor(
    private readonly store: ConversationStore,
    private readonly options: ReplaySessionOptions,
  ) {}

  get state(): ReplayState {
    return this.current;
  }

  /** 开始/重开一次会话（bootstrap 请求已发出，等待快照）。 */
  begin(): void {
    this.current = "awaiting-snapshot";
  }

  onSnapshot(snapshot: ConversationSnapshot): void {
    this.store.replaceSnapshot(snapshot);
    this.current = "streaming";
  }

  /** 未对齐水位（awaiting-snapshot/resyncing）时丢弃 delta，返回 false。 */
  onDelta(delta: ConversationDelta): boolean {
    if (this.current !== "streaming") return false;
    return this.store.applyDelta(delta);
  }

  onDeltas(deltas: readonly ConversationDelta[]): boolean {
    if (this.current !== "streaming") return false;
    return this.store.applyDeltas(deltas);
  }

  /** bridge 降级：终止流式应用，等新快照（reason 原样透传给上层）。 */
  onBridgeDegraded(reason: ReplayDegradeReason): void {
    this.current = "resyncing";
    this.options.onResyncNeeded(reason);
  }

  close(): void {
    this.current = "idle";
  }
}
