// relay-client 公共类型（docs/design/relay-client-interface-draft.md 导出面）。
// 纪律：本包禁止 import react-native / expo / react（AGENTS 规则 4）——
// WebSocket 以 SocketLike 注入：Node 测试用 ws 适配器（test/ws-adapter.ts），
// RN 侧由 app/ 提供全局 WebSocket 适配器，本包零平台 import。

import type {
  WebRemoteControlRelayV2Meta,
  WebRemoteControlV2RetryPolicy,
} from "@nibi-go/shared-extract";

/** 连接状态机——与桌面 device transport 同名同序（relay-v2-pairing.md §03 状态图）。 */
export type ConnState =
  | "idle"
  | "connecting"
  | "authenticating"
  | "waiting_terminal"
  | "paired"
  | "kicked"
  | "error";

/**
 * 数据面选路（D10 四态）。A1 仅声明类型：relay WS 是控制面与中转数据面，
 * 本地直连/打洞（iroh）在 A2+/Spike 后接入，消费方按 RouteKind 选路。
 */
export type RouteKind = "local-direct" | "hole-punch" | "relay-e2e" | "pwa-plaintext";

/** 手机侧持久配对凭据（D8）：免扫重连，仅 链接过期/凭据到期/设备被删 才重配对。 */
export interface PairCredential {
  deviceSid: string;
  deviceMid?: string;
  deviceName?: string;
  appVersion?: string;
  endpointOrigin: string;
  userId?: string;
  savedAt: number;
}

export interface PairCredentialStore {
  load(): Promise<PairCredential | undefined>;
  save(credential: PairCredential): Promise<void>;
  clear(): Promise<void>;
}

/** terminal transport 的错误分类（relay-v2-pairing.md §05 手机侧语义）。 */
export type TerminalTransportErrorKind =
  | "auth-required"
  | "device-not-owned"
  | "invalid-mobile-connection"
  | "session-conflict"
  | "relay-unavailable";

export class TerminalTransportError extends Error {
  constructor(
    readonly kind: TerminalTransportErrorKind,
    readonly retryable = false,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = "TerminalTransportError";
  }
}

/** Socket 抽象：readyState 数值与 WHATWG/RN 一致（0 CONNECTING / 1 OPEN / 2 CLOSING / 3 CLOSED）。 */
export const SOCKET_OPEN = 1;
export const SOCKET_CONNECTING = 0;

/** data payload 的 JSON 值（与 relay 契约 payload: z.json() 对齐的宽松递归类型）。 */
export type RelayJson =
  | string
  | number
  | boolean
  | null
  | RelayJson[]
  | { [key: string]: RelayJson };

export interface SocketLike {
  send(data: string): void;
  close(code?: number): void;
  /** RN 无 abort 连接中握手的能力，适配器可映射为 close（在 A1 App 接入时按平台说明）。 */
  terminate(): void;
  readonly readyState: number;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: string) => void): void;
  onError(listener: () => void): void;
  onClose(listener: () => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface RelayTransportOptions {
  /** relay ws2 入口，如 wss://api.nibistudio.cn/api/v1/remote/ws2（无 query）。 */
  relayWsUrl: string;
  /** 目标桌面 device_sid（扫码或持久凭据，D7/D8）。 */
  deviceSid: string;
  /** 网关路由提示 mid（D7，可选）。 */
  deviceMid?: string;
  /** auth_init.meta（手机名/平台/版本）。 */
  meta?: WebRemoteControlRelayV2Meta;
  /** 一次性 token 获取（内部走 requestTerminalToken；每次建连重新申请，不落盘不进日志）。 */
  getToken(signal: AbortSignal): Promise<string>;
  createSocket: SocketFactory;
  /** 心跳/看门狗覆写（测试提速用；缺省 = V2 常量 5s±1s / 15s）。 */
  timing?: { heartbeatIntervalMs?: number; heartbeatJitterMs?: number; ackTimeoutMs?: number };
  /** 退避策略注入（缺省 = 手机侧 500ms×2ⁿ 最大 10s，jitter ±20%）。 */
  retry?: WebRemoteControlV2RetryPolicy;
  /** A3 信封插桩点（草案 §1）：仅 `data` 类型过钩子，握手类（auth_init/pair_status_query/ping）明文。 */
  transformOutgoingData?: (payload: RelayJson) => RelayJson;
  transformIncomingData?: (payload: RelayJson) => RelayJson | null;
  logger?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  onStateChange(state: ConnState): void;
  /** 已配对收到的 data payload（A3 前为明文 JSON；chat-core 在 A2 接手解析）。 */
  onData(payload: RelayJson): void;
  onError(error: TerminalTransportError): void;
  /** 重新配对成功上报（same-socket=同代重配，reconnected-socket=断线后新连接）。 */
  onSendReady?(event: { kind: "same-socket" | "reconnected-socket" }): void;
}
