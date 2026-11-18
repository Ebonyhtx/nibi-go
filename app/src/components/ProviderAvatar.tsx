// 供应商 / 模型的小字头像：名称取 1–2 字缩写，强调色按 id 稳定取自现有主题 token。
// 只做确定性字符 + 主题色，不引远程图片或品牌素材。
import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useNibiTheme, type NibiTheme } from "../theme";

/** 五组现有强调色（soft 底 + 同色前景），不做新调色板。 */
const MONOGRAM_TONES = [
  { fg: "brand", bg: "brandSoft" },
  { fg: "steel", bg: "steelSoft" },
  { fg: "ok", bg: "okSoft" },
  { fg: "amber", bg: "amberSoft" },
  { fg: "red", bg: "redSoft" },
] as const satisfies readonly { fg: keyof NibiTheme; bg: keyof NibiTheme }[];

function toneIndex(id: string): number {
  // FNV-1a：同一 id 永远落到同一档颜色。
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % MONOGRAM_TONES.length;
}

/**
 * 名称缩写：优先取前两个词的首字符（`gpt-5.4` → `G5`，`DeepSeek` → `DS`），
 * 单词时取前两个字符（`ollama` → `OL`）；中文按字取前两字。
 */
export function monogramOf(name: string): string {
  const normalized = name
    .trim()
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!normalized) return "N";
  const words = normalized.split(/\s+/u);
  const first = (word: string) => Array.from(word)[0] ?? "";
  if (words.length >= 2) {
    return `${first(words[0]!)}${first(words[1]!)}`.toUpperCase();
  }
  return Array.from(words[0]!).slice(0, 2).join("").toUpperCase();
}

export interface MonogramAvatarProps {
  /** 配色种子；同一 id 稳定同色。 */
  id: string;
  /** 取缩写的名称（供应商名或模型 ID）。 */
  name: string;
  /** 边长：供应商行 38（默认），模型行 20。 */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function MonogramAvatar({ id, name, size = 38, style }: MonogramAvatarProps) {
  const t = useNibiTheme();
  const tone = MONOGRAM_TONES[toneIndex(id)];
  const monogram = monogramOf(name);
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: Math.max(6, Math.round(size * 0.34)),
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: t[tone.bg],
        },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={{
          color: t[tone.fg],
          fontSize: size < 24 ? 9 : Math.round(size * 0.42),
          fontWeight: "700",
          letterSpacing: monogram.length > 1 ? -0.4 : 0,
        }}
      >
        {monogram}
      </Text>
    </View>
  );
}
