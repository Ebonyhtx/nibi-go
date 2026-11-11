// RN Hermes 无全局 WebCrypto：E2E 握手/信封依赖 crypto.getRandomValues。
// 用 expo-crypto 的实现补上（同签名：typedArray 原地填充并返回）。
// 必须在任何 SecureDataChannel/KeyExchange 使用前导入（session.ts 首行导入）。
import * as ExpoCrypto from "expo-crypto";

const target = globalThis as unknown as {
  crypto?: { getRandomValues?: unknown } & Record<string, unknown>;
};

if (typeof target.crypto?.getRandomValues !== "function") {
  target.crypto = {
    ...(target.crypto ?? {}),
    getRandomValues: ExpoCrypto.getRandomValues,
  };
}
