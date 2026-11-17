// COMPOSE 上方的插件快捷动作：多层胶囊卡片折叠成一个按钮，点开向上展开胶囊列表。
//
// 这里只放**插件动作**（composer.actions / composer.tools）。每个动作选中的语义是插入
// 一个 token（命令/技能/插件引用），由内核展开对应模板——不是把动作提示词塞进输入框。

import type { ComponentRef } from "react";
import { useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Effect } from "@nibi-go/plugin-contract";

import { Icon, type IconName } from "./Icon";
import { PluginPopup, type PopupAnchor } from "./PluginPopup";
import type { LoadedPlugin } from "../plugins/store";
import { pluginCapsules, type CapsuleEntry, type ComposerToken } from "../plugins/tokens";
import { radius, space, useNibiTheme } from "../theme";

function capsuleIcon(entry: CapsuleEntry): IconName {
  const name = entry.icon;
  return name === "sparkles" || name === "globe" || name === "doc" || name === "clock"
    ? name
    : "puzzle";
}

function kindLabel(entry: CapsuleEntry): string {
  if (entry.token?.kind === "command") return "命令";
  if (entry.token?.kind === "skill") return "技能";
  if (entry.token?.kind === "plugin") return "插件";
  return "动作";
}

export function CapsuleStack({
  plugins,
  onToken,
  onEffects,
}: {
  plugins: readonly LoadedPlugin[];
  onToken: (token: ComposerToken) => void;
  onEffects: (plugin: LoadedPlugin, action: CapsuleEntry["action"], effects: readonly Effect[]) => void;
}) {
  const t = useNibiTheme();
  const entries = pluginCapsules(plugins);
  const buttonRef = useRef<ComponentRef<typeof Pressable> | null>(null);
  const [anchor, setAnchor] = useState<PopupAnchor | null>(null);
  if (entries.length === 0) return null;

  const open = () => {
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  };

  return (
    <>
      <Pressable
        ref={buttonRef}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`插件快捷动作，共 ${entries.length} 个`}
        style={({ pressed }) => [styles.stack, { opacity: pressed ? 0.72 : 1 }]}
      >
        <View style={[styles.layer, styles.layerBack, { backgroundColor: t.panel, borderColor: t.hairline }]} />
        <View style={[styles.layer, styles.layerMid, { backgroundColor: t.glass, borderColor: t.glassBorder }]} />
        <View
          style={[
            styles.face,
            { backgroundColor: t.glass, borderColor: t.glassBorder },
          ]}
        >
          <Icon name="sparkles" size={13} color={t.brand} />
          <Text style={[styles.count, { color: t.inkSub }]}>快捷 {entries.length}</Text>
          <Icon name="chevron-down" size={11} color={t.inkFaint} />
        </View>
      </Pressable>

      <PluginPopup
        visible={anchor !== null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        width={268}
      >
        <Text style={[styles.title, { color: t.ink }]}>插件快捷动作</Text>
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {entries.map((entry) => (
            <Pressable
              key={`${entry.plugin.parsed.manifest.id}:${entry.action.id}`}
              onPress={() => {
                setAnchor(null);
                if (entry.token) onToken(entry.token);
                else onEffects(entry.plugin, entry.action, entry.effects);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${entry.title}（${entry.plugin.parsed.manifest.name}）`}
              style={({ pressed }) => [
                styles.row,
                { borderColor: t.hairline, opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: t.brandSoft }]}>
                <Icon name={capsuleIcon(entry)} size={15} color={t.brand} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: t.ink }]} numberOfLines={1}>
                  {entry.title}
                </Text>
                <Text style={[styles.rowSub, { color: t.inkFaint }]} numberOfLines={1}>
                  {entry.plugin.parsed.manifest.name} · {kindLabel(entry)}
                </Text>
              </View>
              <Icon name="chevron-right" size={13} color={t.inkGhost} />
            </Pressable>
          ))}
        </ScrollView>
        <Text style={[styles.footnote, { color: t.inkGhost }]}>
          选中后只在 COMPOSE 里加入动作名，具体提示词/技能由插件在内核侧展开。
        </Text>
      </PluginPopup>
    </>
  );
}

const styles = StyleSheet.create({
  stack: {
    width: 104,
    height: 42,
    justifyContent: "flex-end",
  },
  layer: {
    position: "absolute",
    left: 4,
    right: 0,
    height: 30,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  layerBack: { bottom: 10, left: 12, right: 8, opacity: 0.55 },
  layerMid: { bottom: 5, left: 8, right: 4, opacity: 0.8 },
  face: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  count: { fontSize: 10.5, fontWeight: "700" },
  title: {
    fontSize: 12.5,
    fontWeight: "700",
    paddingHorizontal: space(2),
    paddingBottom: space(1.5),
  },
  list: { maxHeight: 330 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
    minHeight: 46,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 12.5, fontWeight: "600" },
  rowSub: { fontSize: 10 },
  footnote: {
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: space(2),
    paddingTop: space(2),
  },
});
