// approvals：审批/提问卡状态机（chat-core README 的两条不变量）。
//   1) 请求绑定连接 generation——连接重建后旧卡作废；作废卡上的"迟到允许"不算数；
//   2) 30s 超时默认拒绝（sweep 由调用方驱动，模块内不持计时器，保持 Node 可测）。
// 说明：interaction 事件的 wire 接线在 A3（Host 审批 capability 开闸）时补，
// 本模块先固化状态机本体与不变量。
export interface ApprovalRequest {
  requestId: string;
  /** 发起该请求时的连接代次。 */
  generation: number;
  title?: string;
}

export interface PendingApproval extends ApprovalRequest {
  /** 到期时刻（now + timeoutMs）。 */
  deadline: number;
}

export type ApprovalDecision = "allow" | "deny";
export type ApprovalResolutionVia = "user" | "timeout";

export interface ApprovalBoardOptions {
  /** 当前连接代次（transport 的 generation）。 */
  generation(): number;
  /** 默认 30s（chat-core README 不变量 2）。 */
  timeoutMs?: number;
  now?: () => number;
  /** 决策落定（用户作答或超时默认拒绝）。 */
  onDecision(request: ApprovalRequest, decision: ApprovalDecision, via: ApprovalResolutionVia): void;
}

export type PresentResult = "accepted" | "stale-generation" | "duplicate";
export type ResolveResult = "resolved" | "late" | "unknown";

export class ApprovalBoard {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly resolved = new Set<string>();
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly options: ApprovalBoardOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  list(): PendingApproval[] {
    return [...this.pending.values()];
  }

  /** 请求卡到达：代次不符（旧连接的迟到请求）直接拒收。 */
  present(request: ApprovalRequest): PresentResult {
    if (request.generation !== this.options.generation()) return "stale-generation";
    if (this.pending.has(request.requestId) || this.resolved.has(request.requestId))
      return "duplicate";
    this.pending.set(request.requestId, {
      ...request,
      deadline: this.now() + this.timeoutMs,
    });
    return "accepted";
  }

  /** 连接重建（generation 变化）：全部在途卡作废，不作任何决策。 */
  voidAll(): void {
    for (const request of this.pending.values()) this.resolved.add(request.requestId);
    this.pending.clear();
  }

  /** 用户作答：仅当前代次在途卡有效；已作废/超时的卡返回 late（迟到的允许不算数）。 */
  resolve(requestId: string, decision: ApprovalDecision): ResolveResult {
    const request = this.pending.get(requestId);
    if (!request) return this.resolved.has(requestId) ? "late" : "unknown";
    if (request.generation !== this.options.generation()) {
      // 代次漂移（调用方未及时 voidAll）：按作废处理，不落决策
      this.pending.delete(requestId);
      this.resolved.add(requestId);
      return "late";
    }
    this.pending.delete(requestId);
    this.resolved.add(requestId);
    this.options.onDecision(request, decision, "user");
    return "resolved";
  }

  /** 超时扫描：到期未答 → 默认拒绝（不变量 2）。返回本次超时数量。 */
  sweep(): number {
    const now = this.now();
    let expired = 0;
    for (const [requestId, request] of this.pending) {
      if (now < request.deadline) continue;
      this.pending.delete(requestId);
      this.resolved.add(requestId);
      this.options.onDecision(request, "deny", "timeout");
      expired += 1;
    }
    return expired;
  }
}
