// 长按消息菜单超量时的「更多插件动作」底部 Sheet：
// - 按所属插件分组展示全部已启用的 message.actions；
// - 动作数 ≥ 8 时自动出现轻量搜索框（按动作名或插件名过滤）；
// - 顶部提供直达「自定义」入口（跳 `/settings/composer` 调整开关与置顶前 3 位）。

import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ComposerCatalogItem } from "../composer/catalog";
import {
  groupMessageMenuItems,
  MESSAGE_POPUP_PINNED_COUNT,
  MESSAGE_SHEET_SEARCH_THRESHOLD,
} from "../composer/messageMenu";
import { useI18n } from "../i18n";
import { PressableScale } from "../motion/PressableScale";
import { radius, space, text, useNibiTheme } from "../theme";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./ui/Sheet";

export function MessageActionsSheet({
  visible,
  items,
  pluginNames,
  onPick,
  onManage,
  onClose,
}: {
  visible: boolean;
  items: readonly ComposerCatalogItem[];
  pluginNames: ReadonlyMap<string, string>;
  onPick: (item: ComposerCatalogItem) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const th = useNibiTheme();
  const { pick, locale } = useI18n();
  const [query, setQuery] = useState("");
  const inputRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  // 退场动画期间保持最近一份非空列表，防止关闭瞬间内容闪白。
  const itemsRef = useRef<readonly ComposerCatalogItem[]>(items);
  if (visible) itemsRef.current = items;
  const shownItems = visible ? items : itemsRef.current;

  useEffect(() => {
    if (!visible) {
      inputRef.current?.blur();
      setQuery("");
    }
  }, [visible]);

  const showSearch = shownItems.length >= MESSAGE_SHEET_SEARCH_THRESHOLD;
  const groups = useMemo(
    () => groupMessageMenuItems(shownItems, pluginNames, query),
    // locale 变化时重新计算，保证分组标题与排序随语言实时刷新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownItems, pluginNames, query, locale],
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={pick("消息插件动作", "Message plugin actions")}
      avoidKeyboard
    >
      <View style={styles.body}>
        <View style={styles.metaRow}>
          <Text style={[styles.metaText, { color: th.inkFaint }]}>
            {pick(
              `共 ${shownItems.length} 项 · 排在前 ${MESSAGE_POPUP_PINNED_COUNT} 位常驻长按浮层`,
              `${shownItems.length} total · top ${MESSAGE_POPUP_PINNED_COUNT} pinned in menu`,
            )}
          </Text>
          <PressableScale
            onPress={() => {
              inputRef.current?.blur();
              onClose();
              onManage();
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={pick("自定义长按消息动作", "Customize message actions")}
            style={[
              styles.manageBtn,
              { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
            ]}
          >
            <Icon name="gear" size={12} color={th.inkSub} />
            <Text style={[styles.manageText, { color: th.inkSub }]}>
              {pick("自定义", "Customize")}
            </Text>
          </PressableScale>
        </View>

        {showSearch ? (
          <View
            style={[
              styles.searchWrap,
              { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
            ]}
          >
            <Icon name="search" size={14} color={th.inkFaint} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder={pick("搜索动作名称或插件…", "Search actions or plugins…")}
              placeholderTextColor={th.inkGhost}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={[styles.searchInput, { color: th.ink }]}
            />
            {query.length > 0 ? (
              <PressableScale
                onPress={() => setQuery("")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={pick("清空筛选", "Clear filter")}
              >
                <Icon name="x" size={14} color={th.inkFaint} />
              </PressableScale>
            ) : null}
          </View>
        ) : null}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {groups.length === 0 ? (
            <Text style={[styles.emptyText, { color: th.inkFaint }]}>
              {pick(
                `没有匹配「${query.trim()}」的消息动作`,
                `No message actions matching "${query.trim()}"`,
              )}
            </Text>
          ) : (
            groups.map((group) => (
              <View key={group.groupKey} style={styles.groupBlock}>
                <Text style={[styles.groupTitle, { color: th.inkFaint }]}>
                  {group.groupTitle} · {group.items.length}
                </Text>
                <View
                  style={[
                    styles.groupCard,
                    { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
                  ]}
                >
                  {group.items.map((item, idx) => (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        inputRef.current?.blur();
                        onPick(item);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${group.groupTitle} ${item.title}`}
                      style={({ pressed }) => [
                        styles.row,
                        idx > 0
                          ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: th.hairline }
                          : null,
                        pressed ? { backgroundColor: th.hover } : null,
                      ]}
                    >
                      <View
                        style={[
                          styles.iconPill,
                          {
                            backgroundColor:
                              item.group === "skill" ? th.steelSoft : th.brandSoft,
                          },
                        ]}
                      >
                        <Icon
                          name={(item.icon ?? "sparkles") as IconName}
                          size={14}
                          color={item.group === "skill" ? th.steel : th.brand}
                        />
                      </View>
                      <Text style={[styles.rowTitle, { color: th.ink }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Icon name="chevron-right" size={13} color={th.inkGhost} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space(4),
    paddingBottom: space(2),
    gap: space(2),
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
  },
  metaText: {
    ...text("micro"),
    flex: 1,
  },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  manageText: {
    ...text("micro"),
    fontWeight: "600",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    height: 36,
  },
  searchInput: {
    flex: 1,
    ...text("small"),
    paddingVertical: 0,
  },
  scroll: {
    maxHeight: 380,
  },
  scrollContent: {
    gap: space(2.5),
    paddingBottom: space(2),
  },
  emptyText: {
    ...text("small"),
    textAlign: "center",
    paddingVertical: space(5),
  },
  groupBlock: {
    gap: space(1),
  },
  groupTitle: {
    ...text("micro"),
    fontWeight: "700",
    paddingHorizontal: space(1),
  },
  groupCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    paddingHorizontal: space(3),
    paddingVertical: space(2.25),
    minHeight: 44,
  },
  iconPill: {
    width: 26,
    height: 26,
    borderRadius: radius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    ...text("body"),
    flex: 1,
    fontWeight: "500",
  },
});
