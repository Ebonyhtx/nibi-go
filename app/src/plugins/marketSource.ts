// 市场源：官方索引与签名侧车（GitHub raw，独立市场仓）。
//
// 生产提示：raw.githubusercontent.com 在国内网络可能不可达；发布前可把同一对文件镜像到
// dl.nibistudio.cn 并把这里换成 CDN 地址（索引格式与签名不变）。
export const MARKET_INDEX_URL =
  "https://raw.githubusercontent.com/Ebonyhtx/nibi-go-market/main/index.json";

/** 侧车地址：与 index.json 同目录的 `.sig`。 */
export const MARKET_INDEX_SIGNATURE_URL = `${MARKET_INDEX_URL}.sig`;
