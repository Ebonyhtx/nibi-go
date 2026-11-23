// RelaySession——App 侧配对/连接编排：PairingFlow（D8）+ RelayTransport（A1-1）+ NibiAuthProvider。
// onData 仅预留（A2：chat-core reducer 接手，本阶段不消费业务 payload）。
// RelaySession——App 侧配对/连接编排：PairingFlow（D8）+ RelayTransport（A1-1）+ NibiAuthProvider。
// 聊天接线（A2-6）与 E2E 握手（A3）在此汇合：secure 通道完成（或降级）后才启动 ChatSession。
// 后台恢复（Spike 2）：切后台连接被 abort、JS 定时器暂停；回前台经 AppState 立即重连，不等退避。
import "./cryptoPolyfill";

import { AppState } from "react-native";

import { startKeepAlive, stopKeepAlive } from "nibi-keepalive";

import { ensureNotificationSetup } from "./notifications";

import type { WebRemoteControlRelayV2Device } from "@nibi-go/shared-extract";
import {
  PairingFlow,
  RelayTransport,
  SecureDataChannel,
  listDevices,
  parseDesktopQr,
  qrEndpointOrigin,
  requestTerminalToken,
  type ConnState,
  type PairCredential,
  type RelayJson,
  type TerminalTransportErrorKind,
} from "@nibi-go/relay-client";

import { pickText } from "../i18n";
import { ENDPOINT_ORIGIN, relayWsUrlFor } from "./config";
import { NibiAuthProvider } from "./auth";
import { ChatSession } from "./chat";
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
  /** E2E 信封状态（D9：secure=密文；plaintext=对端不支持协商的降级；UI 必须明示）。 */
  encryption: "idle" | "negotiating" | "secure" | "plaintext";
  error: SessionError | null;
}

function errorTextFor(kind: string): string {
  switch (kind) {
    case "auth-required":
      return pickText("需要登录 NIBI 账号", "NIBI account sign-in required");
    case "device-not-owned":
      return pickText("该设备不属于当前账号", "This device does not belong to the current account");
    case "invalid-mobile-connection":
      return pickText(
        "连接参数无效，请扫描桌面端最新二维码",
        "Invalid connection parameters. Please scan the latest QR code on desktop.",
      );
    case "session-conflict":
      return pickText(
        "已在其他设备连接此桌面（会话冲突）",
        "Another device is already connected to this desktop (session conflict)",
      );
    case "relay-unavailable":
      return pickText("中继服务暂不可用", "Relay service temporarily unavailable");
    default:
      return kind;
  }
}

export class RelaySession {
  private readonly auth: NibiAuthProvider;
  private readonly pairing: PairingFlow;
  /** 聊天接线（paired 后自动 bootstrap workspace bridge 并订阅桌面当前会话）。 */
  readonly chat: ChatSession;
  private transport?: RelayTransport;
  private secure?: SecureDataChannel;
  private paired = false;
  private chatStarted = false;
  private listeners = new Set<() => void>();
  private snapshot: SessionSnapshot = {
    loggedIn: false,
    connState: "idle",
    encryption: "idle",
    error: null,
  };

  constructor() {
    this.auth = new NibiAuthProvider();
    this.pairing = new PairingFlow(pairCredentialStore);
    this.chat = new ChatSession({
      send: (payload: RelayJson) => this.transport?.sendData(payload) ?? false,
      // 前台由 in-app UI 呈现，后台才弹系统通知（A4）
      isForeground: () => AppState.currentState === "active",
      logger: {
        info: (...args) => console.log("[chat]", ...args),
        warn: (...args) => console.warn("[chat]", ...args),
      },
    });
    // A4：通知渠道 + 权限（幂等；失败静默）
    void ensureNotificationSetup();
    // Spike 2 结论：后台期间连接被 abort、定时器暂停；回前台立即重连（跳过退避等待）
    this.appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (this.transport && this.snapshot.connState !== "paired") {
        this.transport.reconnectNow();
      }
    });
    void this.bootstrap();
  }

  /** 业务 API 用的 NIBI access token（付费授权同步等）；未登录/续期失败抛 auth-required。 */
  async accessToken(): Promise<string> {
    return this.auth.getJwt();
  }

  /** AppState 监听句柄（App 卸载时可清理；单例场景保持到进程结束）。 */
  private appStateSubscription?: { remove(): void };

  dispose(): void {
    this.appStateSubscription?.remove();
    this.appStateSubscription = undefined;
    this.disconnect();
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
        error: {
          kind: "login-failed",
          message:
            error instanceof Error ? error.message : pickText("登录失败", "Sign-in failed"),
        },
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
        error: {
          kind: "invalid-qr",
          message: pickText(
            "二维码无效，请扫描桌面端最新二维码",
            "Invalid QR code. Scan the latest QR code on desktop.",
          ),
        },
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
    this.secure?.dispose();
    this.secure = undefined;
    this.paired = false;
    this.chatStarted = false;
    this.chat.teardown();
    stopKeepAlive();
    this.update({ connState: "idle", encryption: "idle" });
  }

  /** 设备列表数据（§06）：401 → auth-required，由调用方引导重新登录。 */
  async fetchDevices(signal: AbortSignal): Promise<WebRemoteControlRelayV2Device[]> {
    const jwt = await this.auth.getJwt(signal);
    const origin = this.snapshot.credential?.endpointOrigin ?? ENDPOINT_ORIGIN;
    return listDevices(origin, jwt, signal);
  }

  private startChatOnce(): void {
    if (!this.paired || this.chatStarted) return;
    this.chatStarted = true;
    void this.chat.start();
  }

  private async startTransport(credential: PairCredential | undefined): Promise<void> {
    if (!credential) {
      this.update({ error: null, connState: "idle" });
      return;
    }
    this.transport?.dispose();
    // E2E 会话级 K（P3b）：每次建连重建握手；deviceSid 作为 KDF context 防跨设备串用
    this.secure?.dispose();
    this.secure = new SecureDataChannel({
      send: (payload) => this.transport?.sendData(payload) ?? false,
      context: credential.deviceSid,
      onSecure: () => {
        this.update({ encryption: "secure" });
        this.startChatOnce();
      },
      onDowngrade: () => {
        this.update({ encryption: "plaintext" });
        this.startChatOnce();
      },
    });
    this.update({
      credential,
      connState: "connecting",
      encryption: "idle",
      error: null,
    });
    const transport = new RelayTransport({
      relayWsUrl: relayWsUrlFor(credential.endpointOrigin),
      deviceSid: credential.deviceSid,
      deviceMid: credential.deviceMid,
      meta: { name: "NIBI-GO", platform: "android" },
      createSocket: createRnSocketFactory(),
      // A1 预留的信封插桩点（草案 §1）：仅 data 类型过钩子
      transformOutgoingData: (payload) =>
        this.secure?.transformOutgoing(payload as RelayJson) ?? payload,
      transformIncomingData: (payload) =>
        this.secure?.transformIncoming(payload as RelayJson) ?? payload,
      getToken: async (signal) => {
        const jwt = await this.auth.getJwt(signal);
        return (await requestTerminalToken(credential.endpointOrigin, jwt, signal)).token;
      },
      logger: {
        info: (...args) => console.log("[relay]", ...args),
        // 禁止把 token/JWT 打进日志（规则 14）——transport 只输出固定文案
        warn: (...args) => console.warn("[relay]", ...args),
      },
      onStateChange: (state) => {
        this.update({ connState: state });
        // 配对成功 → 启动 E2E 握手（完成后或降级后由 startChatOnce 启动聊天）；
        // 离开 paired（断线/冲突）→ 拆桥拆握手（重配对后重新 bootstrap + 新 K）
        if (state === "paired" && !this.paired) {
          this.paired = true;
          this.secure?.begin();
          // A4 KeepAlive：连接期间前台服务保活（Spike 2：无它切后台即断）
          startKeepAlive(
            pickText("NIBI-GO 已连接", "NIBI-GO connected"),
            this.snapshot.credential?.deviceName
              ? pickText(
                  `已连接 ${this.snapshot.credential.deviceName}`,
                  `Connected to ${this.snapshot.credential.deviceName}`,
                )
              : pickText("保持与桌面的远程连接", "Keeping remote connection to desktop active"),
          );
        } else if (state !== "paired" && this.paired) {
          this.paired = false;
          this.chatStarted = false;
          this.secure?.dispose();
          this.chat.teardown();
          stopKeepAlive();
          this.update({ encryption: "idle" });
        }
      },
      onData: (payload) => {
        // 握手完成前 keyneg-response 已被 secure 层吞掉；这里收到的是明文控制回包或解密后的业务帧
        this.chat.acceptPayload(payload);
      },
      onError: (error) =>
        this.update({
          error: {
            kind: error.kind,
            message: errorTextFor(error.kind),
          },
        }),
    });
    this.transport = transport;
    transport.start();
  }
}
