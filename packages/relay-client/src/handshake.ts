// E2E 握手（D9）：X25519 ephemeral ECDH + HKDF-SHA256，会话级 K（P3b）。
// 载体：relay data payload（keyneg-init / keyneg-response）——relay data 是 z.json() 不透明透传，
// **服务端零改动**。注：草案原写 auth_init.meta 透传，但抽取契约里 meta 是 strictObject
// （仅 name/platform/version）且 relay 不把 terminal 的 meta 转给 device——meta 载体到不了桌面，
// 故改用 data payload（规格见 docs/design/e2e-envelope-v1.md 的差异说明）。
// 防重放/降级：
//   - 每连接新握手、新 K（会话级，P3b）；重复 keyneg-response 忽略；
//   - 对端无响应（旧桌面）→ timeout 后降级明文 + onDowngrade（D9 fail-safe，UI 明示未加密）；
//   - 握手完成前收到的 enc 载荷一律丢弃。
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { decodeWireBase64, encodeWireBytesBase64 } from "@nibi-go/shared-extract";

import {
  E2E_KEY_BYTES,
  E2E_NONCE_BYTES,
  generateNonce,
  isEncryptedPayload,
  openPayload,
  sealPayload,
} from "./crypto";
import type { RelayJson } from "./types";

export const KEYNEG_INIT_TYPE = "keyneg-init";
export const KEYNEG_RESPONSE_TYPE = "keyneg-response";
const KEYNEG_VERSION = 1;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 3_000;

export interface KeyNegInitPayload {
  nibi_type: typeof KEYNEG_INIT_TYPE;
  v: number;
  /** X25519 临时公钥（32B base64）。 */
  pub: string;
  /** 32B 随机数（base64），参与 KDF salt 与防重放。 */
  nonce: string;
}

export interface KeyNegResponsePayload {
  nibi_type: typeof KEYNEG_RESPONSE_TYPE;
  v: number;
  pub: string;
  nonce: string;
}

export function isKeyNegInit(payload: unknown): payload is KeyNegInitPayload {
  return isKeyNegPayload(payload, KEYNEG_INIT_TYPE);
}

export function isKeyNegResponse(payload: unknown): payload is KeyNegResponsePayload {
  return isKeyNegPayload(payload, KEYNEG_RESPONSE_TYPE);
}

function isKeyNegPayload(payload: unknown, type: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return (
    record.nibi_type === type &&
    record.v === KEYNEG_VERSION &&
    typeof record.pub === "string" &&
    typeof record.nonce === "string"
  );
}

/** K = HKDF-SHA256(sharedSecret, salt = clientNonce ‖ serverNonce, info = "nibi-e2e-v1|<context>")。 */
export function deriveSessionKey(params: {
  sharedSecret: Uint8Array;
  clientNonce: Uint8Array;
  serverNonce: Uint8Array;
  context: string;
}): Uint8Array {
  const salt = new Uint8Array(params.clientNonce.length + params.serverNonce.length);
  salt.set(params.clientNonce, 0);
  salt.set(params.serverNonce, params.clientNonce.length);
  const info = new TextEncoder().encode(`nibi-e2e-v1|${params.context}`);
  return hkdf(sha256, params.sharedSecret, salt, info, E2E_KEY_BYTES);
}

/** terminal 侧一次握手的密钥材料（每次建连新建，不复用）。 */
export class KeyExchange {
  private readonly secret = x25519.utils.randomSecretKey();
  readonly clientNonce = generateNonce();
  readonly publicKey = x25519.getPublicKey(this.secret);

  constructor(private readonly context: string) {}

  initPayload(): KeyNegInitPayload {
    return {
      nibi_type: KEYNEG_INIT_TYPE,
      v: KEYNEG_VERSION,
      pub: encodeWireBytesBase64(this.publicKey),
      nonce: encodeWireBytesBase64(this.clientNonce),
    };
  }

  /** 桌面回包 → 派生会话 K；非法材料返回 null。 */
  acceptResponse(payload: KeyNegResponsePayload): Uint8Array | null {
    const serverPublic = decodeWireBase64(payload.pub);
    const serverNonce = decodeWireBase64(payload.nonce);
    if (
      !serverPublic ||
      serverPublic.length !== 32 ||
      !serverNonce ||
      serverNonce.length !== E2E_NONCE_BYTES
    ) {
      return null;
    }
    try {
      const sharedSecret = x25519.getSharedSecret(this.secret, serverPublic);
      return deriveSessionKey({
        sharedSecret,
        clientNonce: this.clientNonce,
        serverNonce,
        context: this.context,
      });
    } catch {
      return null;
    }
  }
}

export type SecureChannelState = "idle" | "negotiating" | "secure" | "plaintext";

export interface SecureDataChannelOptions {
  /** 发送 relay data payload（通常为 transport.sendData）。 */
  send(payload: RelayJson): boolean;
  /** 握手绑定上下文（双方已知、非秘密）：用 deviceSid，防止跨设备派生串用。 */
  context: string;
  /** 握手完成（K 已就绪）。 */
  onSecure?(): void;
  /** 对端不支持协商（旧桌面）→ 降级明文（D9 fail-safe）。 */
  onDowngrade?(): void;
  timeoutMs?: number;
}

/**
 * transport 信封插桩点（A1 预留的 transformOutgoing/IncomingData）的实现：
 * 握手期间 keyneg 明文；完成后所有 data 载荷加密（keyneg 自身除外）。
 */
export class SecureDataChannel {
  private current: SecureChannelState = "idle";
  private key?: Uint8Array;
  private exchange?: KeyExchange;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: SecureDataChannelOptions) {}

  get state(): SecureChannelState {
    return this.current;
  }

  /** 配对成功后调用：发 keyneg-init 并启动降级计时。 */
  begin(): void {
    if (this.current !== "idle") return;
    this.current = "negotiating";
    this.exchange = new KeyExchange(this.options.context);
    this.options.send(this.exchange.initPayload() as unknown as RelayJson);
    this.timer = setTimeout(() => {
      if (this.current !== "negotiating") return;
      // 旧桌面不响应协商：放行明文（用户已接受的默认）
      this.current = "plaintext";
      this.exchange = undefined;
      this.options.onDowngrade?.();
    }, this.options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);
  }

  /** transformOutgoingData 钩子：secure 后加密（keyneg 明文）。 */
  transformOutgoing(payload: RelayJson): RelayJson {
    if (this.current !== "secure" || !this.key) return payload;
    const type = (payload as { nibi_type?: unknown }).nibi_type;
    if (type === KEYNEG_INIT_TYPE || type === KEYNEG_RESPONSE_TYPE) return payload;
    return sealPayload(payload, this.key) as unknown as RelayJson;
  }

  /**
   * transformIncomingData 钩子：
   * - negotiating 收到 keyneg-response → 派生 K、转 secure，吞掉该消息（返回 null）；
   * - secure 收到 enc → 解密后返回内层 payload；
   * - 其他（明文控制/降级后数据）原样放行；握手前的 enc 丢弃。
   */
  transformIncoming(payload: RelayJson): RelayJson | null {
    if (this.current === "negotiating" && isKeyNegResponse(payload)) {
      const key = this.exchange?.acceptResponse(payload);
      if (!key) {
        // 非法材料：降级明文（不静默断连——fail-safe 与"旧桌面"同路径）
        this.current = "plaintext";
        this.exchange = undefined;
        clearTimeout(this.timer);
        this.options.onDowngrade?.();
        return null;
      }
      this.key = key;
      this.current = "secure";
      this.exchange = undefined;
      clearTimeout(this.timer);
      this.options.onSecure?.();
      return null;
    }
    if (isEncryptedPayload(payload)) {
      if (this.current !== "secure" || !this.key) return null;
      return openPayload(payload, this.key);
    }
    return payload;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.current = "idle";
    this.key = undefined;
    this.exchange = undefined;
  }
}
