// 内置的 license 验签公钥（raw Ed25519，hex）。
//
// 来源：NIBI 共享包 `NIBI_LICENSE_PUBLIC_KEYS` 的 SPKI PEM（kid `z0SZbhR92-WZRiLD`），
// 这里把 DER 尾部 32 字节换成 raw hex，客户端用 noble 直接验签，不解析 PEM。
// 轮换：服务器换 key 后追加新 kid；旧 kid 至少保留到未过期凭证失效。
export interface LicenseKey {
  kid: string;
  /** raw 32 字节 Ed25519 公钥，64 位小写 hex。 */
  publicKeyHex: string;
}

export const NIBI_LICENSE_KEYS: Record<string, LicenseKey> = {
  "z0SZbhR92-WZRiLD": {
    kid: "z0SZbhR92-WZRiLD",
    publicKeyHex: "f9060950b71d9a8ac853df9207d161e8a38ad951afb92a357673cc2f4931b027",
  },
};
