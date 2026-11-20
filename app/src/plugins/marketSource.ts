// 市场源（按顺序尝试，首个验签通过的生效）。
//
// 1) dl.nibistudio.cn：NIBI 免费内容 CDN（ESA → 私有 OSS），国内可达；
// 2) GitHub raw：独立市场仓的原始位置（发布编辑在这里）。
//
// 两份文件用同一把 key 签名，客户端只认签名，不认域名；镜像只是可达性手段。
export const MARKET_INDEX_URLS = [
  "https://dl.nibistudio.cn/nibi-go-market/index.json",
  "https://raw.githubusercontent.com/Ebonyhtx/nibi-go-market/main/index.json",
] as const;

/** 展示用默认源。 */
export const MARKET_INDEX_URL = MARKET_INDEX_URLS[0];
