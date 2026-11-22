// 助手消息的富排版（对齐 NIBI 客户端消息流的可读性）：
//   1. 标题/列表/表格/引用/代码井走 @ronradtke/react-native-markdown-display；
//   2. ```html / ```svg 围栏 = 可视化工件（图表/网页）→ 工件卡 + WebView 预览，
//      不再把整段 HTML 摊在消息里；
//   3. 模块级单例 MarkdownIt + colorScheme={useNibiScheme()} + 完整深浅色样式，
//      既消除每帧重复建解析器，也保证流式→落定字号/行高一致不跳变。
import Markdown, {
  createMarkdownIt,
  type MarkdownStyleMap,
} from "@ronradtke/react-native-markdown-display";
import { memo, useMemo, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";

import { Sheet } from "./ui/Sheet";
import { Icon } from "./Icon";
import { haptic } from "../motion/haptics";
import { PressableScale } from "../motion/PressableScale";
import { radius, space, text, useNibiScheme, useNibiTheme } from "../theme";

/** 模块级单例解析器：库默认在每次渲染时 new MarkdownIt()，复用单例省下大量纯 JS 构造开销。 */
const SHARED_MARKDOWN_IT = createMarkdownIt();

/** 粗测是否带 markdown 语法：纯聊天文本不进 markdown 管线（省一次解析）。 */
export function hasMarkdownSyntax(text: string): boolean {
  return /(^|\n)#{1,6} |\n[-*] |\n\d+\. |\*\*[^*\n]+\*\*|```|\n> |\n\|.+\|/u.test(text);
}

export interface VisualArtifact {
  lang: "html" | "svg";
  code: string;
}

/** 把 html/svg 围栏从正文里摘出来（按顺序回填，正文占位替换为空段）。 */
export function splitVisualArtifacts(text: string): {
  segments: Array<{ kind: "md" | "artifact"; value: string }>;
  artifacts: VisualArtifact[];
} {
  const segments: Array<{ kind: "md" | "artifact"; value: string }> = [];
  const artifacts: VisualArtifact[] = [];
  // 围栏语言行要容忍 CRLF 与尾部空格（模型/内核的换行形态不定，失配 = 整段源码
  // 摊进消息流——正是运营者抱怨的形态）。
  const pattern = /```(html|svg)[ \t]*\r?\n([\s\S]*?)```/giu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(cursor, match.index);
    if (before.trim().length > 0) segments.push({ kind: "md", value: before });
    const lang = match[1]!.toLowerCase() as "html" | "svg";
    artifacts.push({ lang, code: match[2] ?? "" });
    segments.push({ kind: "artifact", value: String(artifacts.length - 1) });
    cursor = match.index! + match[0].length;
  }
  const rest = text.slice(cursor);
  if (rest.trim().length > 0) segments.push({ kind: "md", value: rest });
  return { segments, artifacts };
}

/** 流式期间检测未闭合的 html/svg 围栏：切出已完成前缀 + 紧凑占位卡，避免把大段源码摊平再塌缩。 */
export function splitPendingArtifact(text: string): {
  prefix: string;
  pendingLang: "html" | "svg" | null;
  pendingLines: number;
} {
  // 去掉已闭合围栏后，如果尾部还有未闭合的 ```html / ```svg，就把它收成生成中卡片。
  const openPattern = /```(html|svg)[ \t]*\r?\n([\s\S]*)$/iu;
  // 先找到最后一个闭合围栏之后的位置，避免误伤已闭合的围栏。
  const closedPattern = /```(?:html|svg)[ \t]*\r?\n[\s\S]*?```/giu;
  let afterClosed = 0;
  for (const match of text.matchAll(closedPattern)) {
    afterClosed = match.index! + match[0].length;
  }
  const tail = text.slice(afterClosed);
  const openMatch = openPattern.exec(tail);
  if (!openMatch) {
    return { prefix: text, pendingLang: null, pendingLines: 0 };
  }
  const cut = afterClosed + openMatch.index;
  const body = openMatch[2] ?? "";
  return {
    prefix: text.slice(0, cut),
    pendingLang: openMatch[1]!.toLowerCase() as "html" | "svg",
    pendingLines: body.length === 0 ? 0 : body.split("\n").length,
  };
}

/** 工件包一层离线可渲染的页面骨架：viewport + 白底 + 居中，svg 自适应宽。 */
function artifactHtml(lang: "html" | "svg", code: string): string {
  const shell =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:12px;background:#fff;font-family:system-ui,sans-serif;color:#222}svg{max-width:100%;height:auto}</style></head><body>';
  if (lang === "svg") return `${shell}${code}</body></html>`;
  return /<html[\s>]/iu.test(code) ? code : `${shell}${code}</body></html>`;
}

/** 流式中的可视化工件占位卡：与落定后的 ArtifactCard 同高同宽，落定时不跳屏。 */
export const PendingArtifactCard = memo(function PendingArtifactCard({
  lang,
  lines,
}: {
  lang: "html" | "svg";
  lines: number;
}) {
  const th = useNibiTheme();
  return (
    <View style={[styles.artifact, { borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}>
      <View style={styles.artifactRow}>
        <View style={[styles.artifactIcon, { backgroundColor: th.brandSoft }]}>
          <Icon name="globe" size={13} color={th.brand} />
        </View>
        <View style={styles.artifactCol}>
          <Text style={[styles.artifactTitle, { color: th.ink }]}>
            正在生成可视化 · {lang.toUpperCase()}
          </Text>
          <Text style={[styles.artifactMeta, { color: th.inkFaint }]}>
            已接收 {lines} 行，完成后可全屏预览
          </Text>
        </View>
      </View>
    </View>
  );
});

/** 可视化工件卡：折叠一行（语言+行数），「预览」弹全高 WebView，右上角可切全屏。
 * 必须放在消息的长按 Pressable 之外——嵌套 Pressable 会被外层吞掉触摸。
 * Sheet 懒挂载：从未点开过的历史工件不挂 Modal/WebView 树，省内存也省流式重渲开销。 */
export const ArtifactCard = memo(function ArtifactCard({
  artifact,
}: {
  artifact: VisualArtifact;
}) {
  const th = useNibiTheme();
  const { height: screenHeight } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const lines = artifact.code.trim().split("\n").length;
  return (
    <View style={[styles.artifact, { borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}>
      <View style={styles.artifactRow}>
        <View style={[styles.artifactIcon, { backgroundColor: th.brandSoft }]}>
          <Icon name="globe" size={13} color={th.brand} />
        </View>
        <View style={styles.artifactCol}>
          <Text style={[styles.artifactTitle, { color: th.ink }]}>
            可视化 · {artifact.lang.toUpperCase()}
          </Text>
          <Text style={[styles.artifactMeta, { color: th.inkFaint }]}>
            图表 / 网页 · {lines} 行
          </Text>
        </View>
        <PressableScale
          scaleTo={0.95}
          onPress={() => {
            haptic("tap");
            setMounted(true);
            setOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`预览 ${artifact.lang} 可视化`}
          style={[
            styles.artifactButton,
            { backgroundColor: th.card, borderColor: th.hairline },
          ]}
        >
          <Icon name="eye" size={12} color={th.brand} />
          <Text style={[styles.artifactButtonText, { color: th.brand }]}>预览</Text>
        </PressableScale>
      </View>
      {mounted ? (
        <Sheet
          visible={open}
          onClose={() => {
            setOpen(false);
            setMaximized(false);
          }}
          maxHeightRatio={maximized ? 1 : 0.94}
        >
          <View
            style={[
              maximized ? styles.artifactSheetFull : styles.artifactSheetHead,
              maximized ? { borderBottomColor: th.hairline } : null,
            ]}
          >
            <Icon name="globe" size={15} color={th.brand} />
            <Text style={[styles.artifactSheetTitle, { color: th.ink }]}>
              可视化 · {artifact.lang.toUpperCase()}
            </Text>
            <PressableScale
              scaleTo={0.92}
              onPress={() => {
                haptic("tick");
                setMaximized((value) => !value);
              }}
              accessibilityRole="button"
              accessibilityLabel={maximized ? "退出全屏" : "全屏查看"}
              hitSlop={8}
              style={styles.artifactMaxButton}
            >
              <Icon name="maximize" size={15} color={th.inkSub} />
            </PressableScale>
            <PressableScale
              scaleTo={0.92}
              onPress={() => {
                setOpen(false);
                setMaximized(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="关闭预览"
              hitSlop={8}
              style={styles.artifactCloseButton}
            >
              <Icon name="x" size={15} color={th.inkSub} />
            </PressableScale>
          </View>
          <View
            style={[
              styles.artifactWeb,
              { height: maximized ? Math.round(screenHeight * 0.92) - 56 : 540 },
            ]}
          >
            <WebView source={{ html: artifactHtml(artifact.lang, artifact.code) }} />
          </View>
        </Sheet>
      ) : null}
    </View>
  );
});

/** 助手消息的 markdown 渲染（纯排版）；html/svg 围栏由调用方先摘出来单独渲染
 * ArtifactCard（要放在消息长按 Pressable 之外）。
 * 单例 markdownit + memo + 完整主题映射：既快又与流式 BodyText 字号/行高 1:1 对齐。 */
export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  const th = useNibiTheme();
  const scheme = useNibiScheme();
  const style = useMemo(() => markdownStyle(th), [th]);
  return (
    <Markdown style={style} colorScheme={scheme} markdownit={SHARED_MARKDOWN_IT}>
      {text}
    </Markdown>
  );
});

function markdownStyle(th: ReturnType<typeof useNibiTheme>): MarkdownStyleMap {
  return {
    // body 与 BodyText（text("body") + th.ink）完全对齐，深色可见、落定零字号跳变。
    body: { ...text("body"), color: th.ink },
    heading1: { ...text("title"), color: th.ink, fontWeight: "700", marginTop: space(3), marginBottom: space(1.5) },
    heading2: { ...text("bodyLg"), color: th.ink, fontWeight: "700", marginTop: space(3), marginBottom: space(1.5) },
    heading3: { ...text("body"), color: th.ink, fontWeight: "700", marginTop: space(2.5), marginBottom: space(1) },
    heading4: { ...text("body"), color: th.ink, fontWeight: "700", marginTop: space(2), marginBottom: space(1) },
    heading5: { ...text("small"), color: th.ink, fontWeight: "700", marginTop: space(2), marginBottom: space(1) },
    heading6: { ...text("small"), fontWeight: "700", color: th.inkSub, marginTop: space(2), marginBottom: space(1) },
    paragraph: { marginTop: 0, marginBottom: space(2) },
    strong: { fontWeight: "700" },
    em: { fontStyle: "italic" },
    link: { color: th.brand, textDecorationLine: "underline" },
    code_inline: {
      ...text("small"),
      fontFamily: "monospace",
      backgroundColor: th.surfaceSoft,
      color: th.ink,
      borderRadius: radius.xs,
      borderWidth: 0,
      padding: 0,
      paddingHorizontal: space(1),
    },
    fence: {
      ...text("small"),
      fontFamily: "monospace",
      backgroundColor: th.surfaceSoft,
      color: th.inkSub,
      borderRadius: radius.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: th.hairline,
      padding: space(2),
      marginTop: 0,
      marginBottom: space(2),
    },
    code_block: {
      ...text("small"),
      fontFamily: "monospace",
      backgroundColor: th.surfaceSoft,
      color: th.inkSub,
      borderRadius: radius.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: th.hairline,
      padding: space(2),
      marginTop: 0,
      marginBottom: space(2),
    },
    blockquote: {
      backgroundColor: th.surfaceSoft,
      borderLeftWidth: 2,
      borderLeftColor: th.brandSoft,
      borderRadius: radius.xs,
      paddingHorizontal: space(2.5),
      paddingVertical: space(1),
      marginVertical: space(1.5),
    },
    bullet_list: { marginBottom: space(2) },
    ordered_list: { marginBottom: space(2) },
    list_item: { marginVertical: space(0.5) },
    bullet_list_icon: { color: th.brand, marginLeft: space(1), marginRight: space(1.5) },
    ordered_list_icon: { color: th.brand, marginLeft: space(1), marginRight: space(1.5) },
    table: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: th.hairline,
      borderRadius: radius.xs,
      marginVertical: space(1.5),
    },
    tr: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: th.hairline,
    },
    th: {
      ...text("micro"),
      fontWeight: "700",
      color: th.inkSub,
      backgroundColor: th.surfaceSoft,
      borderColor: th.hairline,
      padding: space(1.5),
    },
    td: {
      ...text("small"),
      color: th.ink,
      borderColor: th.hairline,
      padding: space(1.5),
    },
    hr: { backgroundColor: th.hairline, marginVertical: space(2.5) },
  };
}

const styles = StyleSheet.create({
  artifact: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    marginVertical: space(1.5),
    overflow: "hidden",
  },
  artifactRow: { flexDirection: "row", alignItems: "center", gap: space(2.5), padding: space(3) },
  artifactIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  artifactCol: { flex: 1, minWidth: 0 },
  artifactTitle: { ...text("small"), fontWeight: "700" },
  artifactMeta: { ...text("micro"), marginTop: 2 },
  artifactButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  artifactButtonText: { ...text("micro"), fontWeight: "700" },
  artifactSheetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
  },
  artifactSheetFull: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  artifactMaxButton: {
    marginLeft: "auto",
    width: 32,
    height: 32,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  artifactCloseButton: {
    width: 32,
    height: 32,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  artifactSheetTitle: { ...text("body"), fontWeight: "700" },
  artifactWeb: { height: 540 },
});
