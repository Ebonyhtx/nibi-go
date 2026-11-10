// RelaySession——App 侧配对/连接编排：PairingFlow（D8）+ RelayTransport（A1-1）+ NibiAuthProvider。
// onData 仅预留（A2：chat-core reducer 接手，本阶段不消费业务 payload）。
import type { WebRemoteControlRelayV2Device } from "@nibi-go/shared-extract";
import {
  PairingFlow,
  RelayTransport,
  listDevices,
  parseDesktopQr,
  qrEndpointOrigin,
  requestTerminalToken,
  type ConnState,
  type PairCredential,
  type TerminalTransportErrorKind,
} from "@nibi-go/relay-client";

import { ENDPOINT_ORIGIN, relayWsUrlFor } from "./config";
import { NibiAuthProvider } from "./auth";
import { pairCredentialStore, tokenStore } from "./secureStore";
import { createRnSocketFactory } from "./wsAdapter";

export interface SessionError {
  kind: TerminalTransportErrorKind | "invalid-qr" | "login-failed";
  message: string;
}

export interface SessionSnapshot {
  loggedIn: boolean;
  displayName?: string;
  credential?: PairCredential;
  connState: ConnState;
  error: SessionError | null;
}

const ERROR_TEXT: Record<string, string> = {
  "auth-required": "需要登录 NIBI 账号",
  "device-not-owned": "该设备不属于当前账号",
  "invalid-mobile-connection": "连接参数无效，请扫描桌面端最新二维码",
  "session-conflict": "已在其他设备连接此桌面（会话冲突）",
  "relay-unavailable": "中继服务暂不可用",
};

export class RelaySession {
  private readonly auth: NibiAuthProvider;
  private readonly pairing: PairingFlow;
  private transport?: RelayTransport;
  private listeners = new Set<() => void>();
  private snapshot: SessionSnapshot = { loggedIn: false, connState: "idle", error: null };

  constructor() {
    this.auth = new NibiAuthProvider();
    this.pairing = new PairingFlow(pairCredentialStore);
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const tokens = await tokenStore.load();
    const credential = await pairCredentialStore.load();
    this.update({
      ...(tokens ? { loggedIn: true, displayName: tokens.displayName } : {}),
      ...(credential ? { credential } : {}),
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  async login(forceLogin = false): Promise<void> {
    try {
      const tokens = await this.auth.login(forceLogin);
      this.update({ loggedIn: true, displayName: tokens.displayName, error: null });
    } catch (error) {
      this.update({
        error: { kind: "login-failed", message: error instanceof Error ? error.message : "登录失败" },
      });
    }
  }

  async logout(): Promise<void> {
    this.disconnect();
    await this.auth.logout();
    this.update({ loggedIn: false, displayName: undefined, error: null });
  }

  /** 扫码入口（D8 首次配对/重扫同一桌面）：解析 → 落凭据 → 建连。 */
  async startFromQr(raw: string): Promise<void> {
    const qr = parseDesktopQr(raw);
    const origin = qrEndpointOrigin(raw);
    if (!qr?.deviceSid || !origin) {
      this.update({
        error: { kind: "invalid-qr", message: "二维码无效，请扫描桌面端最新二维码" },
      });
      return;
    }
    const credential = await this.pairing.resolveTarget({ qr, origin });
    await this.startTransport(credential);
  }

  /** 设备列表入口（§06 简化版：手动选择在线设备）。 */
  async startFromDevice(device: WebRemoteControlRelayV2Device): Promise<void> {
    const credential = await this.pairing.resolveTarget({
      qr: {
        deviceSid: device.device_sid,
        deviceMid: device.device_mid,
        deviceName: device.meta.name,
      },
      origin: ENDPOINT_ORIGIN,
    });
    await this.startTransport(credential);
  }

  /** 免扫重连（D8）：持久凭据直接建连。 */
  async resume(): Promise<void> {
    const credential = await this.pairing.resolveTarget(null);
    if (credential) await this.startTransport(credential);
  }

  disconnect(): void {
    this.transport?.dispose();
    this.transport = undefined;
    this.update({ connState: "idle" });
  }

  /** 设备列表数据（§06）：401 → auth-required，由调用方引导重新登录。 */
  async fetchDevices(signal: AbortSignal): Promise<WebRemoteControlRelayV2Device[]> {
    const jwt = await this.auth.getJwt(signal);
    const origin = this.snapshot.credential?.endpointOrigin ?? ENDPOINT_ORIGIN;
    return listDevices(origin, jwt, signal);
  }

  private async startTransport(credential: PairCredential | undefined): Promise<void> {
    if (!credential) {
      this.update({ error: null, connState: "idle" });
      return;
    }
    this.transport?.dispose();
    this.update({
      credential,
      connState: "connecting",
      error: null,
    });
    const transport = new RelayTransport({
      relayWsUrl: relayWsUrlFor(credential.endpointOrigin),
      deviceSid: credential.deviceSid,
      deviceMid: credential.deviceMid,
      meta: { name: "NIBI-GO", platform: "android" },
      createSocket: createRnSocketFactory(),
      getToken: async (signal) => {
        const jwt = await this.auth.getJwt(signal);
        return (await requestTerminalToken(credential.endpointOrigin, jwt, signal)).token;
      },
      logger: {
        info: (...args) => console.log("[relay]", ...args),
        // 禁止把 token/JWT 打进日志（规则 14）——transport 只输出固定文案
        warn: (...args) => console.warn("[relay]", ...args),
      },
      onStateChange: (state) => this.update({ connState: state }),
      onData: () => {
        // A2：chat-core reducer 接手（V4 事件 → 消息树）；A1 阶段不消费
      },
      onError: (error) =>
        this.update({
          error: {
            kind: error.kind,
            message: ERROR_TEXT[error.kind] ?? error.kind,
          },
        }),
    });
    this.transport = transport;
    transport.start();
  }
}
