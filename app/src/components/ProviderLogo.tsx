// 官方 Provider 标志：内核的 `config.logo` 给出 builtin key，这里映射到随包的 PNG。
// 资产来自 NIBI Client 的 `provider-icons`（只读源，按文件名原样复制）；没有 PNG 的
// key（bigmodel / openrouter / opencode）与个人 Provider 仍由调用方回退到 monogram。
import { Image } from "react-native";

import { MonogramAvatar } from "./ProviderAvatar";

/** key → 官方 PNG（文件名与 NIBI Client 一致；zai 是 128x128，其余 80x80）。 */
const PROVIDER_LOGOS = {
  zai: require("../../assets/provider-logos/model-provider-zai-app.png"),
  "moonshot-kimi": require("../../assets/provider-logos/model-provider-moonshot-kimi.png"),
  minimax: require("../../assets/provider-logos/model-provider-minimax.png"),
  deepseek: require("../../assets/provider-logos/model-provider-deepseek.png"),
  "alibaba-model-studio": require("../../assets/provider-logos/model-provider-alibaba-cloud.png"),
  "xiaomi-mimo": require("../../assets/provider-logos/model-provider-xiaomi-mimo.png"),
  "tencent-cloud": require("../../assets/provider-logos/model-provider-tencent-cloud.png"),
  volcengine: require("../../assets/provider-logos/model-provider-volcengine.png"),
  stepfun: require("../../assets/provider-logos/model-provider-stepfun.png"),
  siliconflow: require("../../assets/provider-logos/model-provider-siliconflow.png"),
  openai: require("../../assets/provider-logos/model-provider-openai.png"),
  anthropic: require("../../assets/provider-logos/model-provider-anthropic.png"),
  xai: require("../../assets/provider-logos/model-provider-xai.png"),
} as const;

type LogoKey = keyof typeof PROVIDER_LOGOS;

export interface ProviderLogoProps {
  /** 内核给的 builtin 标志 key；缺失或未知时回退到 monogram。 */
  logoKey?: string;
  /** 边长（供应商行 38，预设 chip 约 20）。 */
  size: number;
  /** monogram 回退用的配色种子。 */
  id: string;
  /** monogram 回退用的名称。 */
  name: string;
}

export function ProviderLogo({ logoKey, size, id, name }: ProviderLogoProps) {
  if (logoKey && Object.prototype.hasOwnProperty.call(PROVIDER_LOGOS, logoKey)) {
    return (
      <Image
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        source={PROVIDER_LOGOS[logoKey as LogoKey]}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }
  return <MonogramAvatar id={id} name={name} size={size} />;
}
