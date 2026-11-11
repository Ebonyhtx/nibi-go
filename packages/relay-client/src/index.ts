// @nibi-go/relay-client 公共入口（草案 §导出面；A1 = transport + pairing，A2-5 = workspace bridge）。
export { RelayTransport } from "./transport";
export {
  E2E_ENVELOPE_VERSION,
  E2E_KEY_BYTES,
  E2E_NONCE_BYTES,
  generateKey,
  generateNonce,
  isEncryptedPayload,
  openPayload,
  sealPayload,
  xchachaCipher,
  type Cipher,
  type EncryptedPayload,
} from "./crypto";
export {
  KEYNEG_INIT_TYPE,
  KEYNEG_RESPONSE_TYPE,
  KeyExchange,
  SecureDataChannel,
  deriveSessionKey,
  isKeyNegInit,
  isKeyNegResponse,
  type KeyNegInitPayload,
  type KeyNegResponsePayload,
  type SecureChannelState,
  type SecureDataChannelOptions,
} from "./handshake";
export {
  WorkspaceBridge,
  ConversationSubscription,
  type BootstrapWorkspace,
  type BridgeBootstrapResult,
  type BridgeDegradedEvent,
  type BridgeWorkspaceTarget,
  type ConversationSubscriptionCallbacks,
  type ExternalBridgeInfo,
  type SendTextOptions,
  type WorkspaceBridgeOptions,
} from "./bridge";
export {
  PairingFlow,
  listDevices,
  parseDesktopQr,
  qrEndpointOrigin,
  requestTerminalToken,
  type FetchLike,
} from "./pairing";
export {
  TerminalTransportError,
  SOCKET_CONNECTING,
  SOCKET_OPEN,
  type ConnState,
  type PairCredential,
  type PairCredentialStore,
  type RelayJson,
  type RelayTransportOptions,
  type RouteKind,
  type SocketFactory,
  type SocketLike,
  type TerminalTransportErrorKind,
} from "./types";
