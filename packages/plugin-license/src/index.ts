// NIBI 付费插件凭证（license）的离线校验。
//
// 与桌面端同一签发口径：compact JWS（Ed25519），header.kid 指向内置公钥，
// claims.iss 必须为 "nibi-license"，plugins 列出可用的插件 id（"*" = 全部），
// dev 是设备绑定，exp 是硬到期。
//
// 这里只做**离线**判定：在线拒绝/宽限期由后续接入账号侧时补（本阶段不启动收费）。
export * from "./claims";
export * from "./keys";
export * from "./verify";
export * from "./evaluate";
