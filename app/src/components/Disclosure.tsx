// 可折叠摘要行（思考块 / 工具行 / 工具组共用）：
//   头部一行 = 图标 + 标题 + 副标题 + 折角，点整行切换；
//   展开体可选左侧细线（rail），用来把详情挂在摘要行下面。
// title/subtitle 传字符串时按内置字号渲染；传节点时由调用方控制排版。
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { space, useNibiTheme } from "../theme";
import { Icon } from "./Icon";

export interface DisclosureProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
  /** 展开体左侧竖线（思考正文 / 工具详情）。 */
  rail?: boolean;
}

export function Disclosure({
  icon,
  title,
  subtitle,
  open,
  onToggle,
  children,
  rail = false,
}: DisclosureProps) {
  const th = useNibiTheme();
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={6}
        style={styles.header}
      >
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        <View style={styles.title}>
          {typeof title === "string" || typeof title === "number" ? (
            <Text style={[styles.titleText, { color: th.inkSub }]} numberOfLines={1}>
              {title}
            </Text>
          ) : (
            title
          )}
        </View>
        {subtitle ? (
          <View style={styles.subtitle}>
            {typeof subtitle === "string" || typeof subtitle === "number" ? (
              <Text style={[styles.subtitleText, { color: th.inkGhost }]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : (
              subtitle
            )}
          </View>
        ) : null}
        <View style={styles.chevron}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={13} color={th.inkFaint} />
        </View>
      </Pressable>
      {open && children ? (
        <View
          style={[
            styles.body,
            rail
              ? {
                  borderLeftWidth: 2,
                  borderLeftColor: th.hairline,
                  paddingLeft: space(3),
                }
              : null,
          ]}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space(1.5), minHeight: 30 },
  icon: { alignItems: "center", justifyContent: "center" },
  // 标题不参与挤压；超长时由调用方的 Text 自行截断。
  title: { flexShrink: 0, maxWidth: "60%" },
  titleText: { fontSize: 12.5, fontWeight: "600" },
  // 副标题吃掉剩余宽度：流式预览靠 head 省略显示最新尾巴。
  // 用内容做基准（不写 flex:1），思考块这种宽度自适应的容器里也不会被压成 0。
  subtitle: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  subtitleText: { fontSize: 11 },
  // 没有副标题时也把折角顶到行尾。
  chevron: { marginLeft: "auto" },
  body: { paddingVertical: space(1), paddingLeft: space(1), gap: space(1.5) },
});
