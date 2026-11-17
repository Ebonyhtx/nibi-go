// COMPOSE 配置：胶囊快捷动作、加号菜单、长按消息菜单。
//
// 统一的目录（catalog）来自 NIBI 原生命令 + 插件命令/插件卡片 + 本机/插件技能；
// 这里只改启用与顺序，动作语义由 catalog 的 token 决定。

import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "../../components/Icon";
import {
  capsuleEligible,
  messageEligible,
  PLUS_GROUPS,
  type ComposerCatalogItem,
} from "../../composer/catalog";
import {
  moveInList,
  saveComposerPreferences,
  toggleInList,
  type ComposerPreferences,
} from "../../composer/preferences";
import { useComposerCatalog } from "../../composer/useComposerCatalog";
import { useComposerPreferences } from "../../composer/useComposerPreferences";
import { radius, space, type as typeScale, useNibiTheme } from "../../theme";

function ToggleRow({
  item,
  checked,
  onToggle,
  onMove,
  canMoveUp,
  canMoveDown,
  last,
}: {
  item: ComposerCatalogItem;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  last?: boolean;
}) {
  const t = useNibiTheme();
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.hairline },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: t.panel }]}>
        <Icon name={(item.icon ?? "puzzle") as IconName} size={15} color={t.inkSub} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: t.ink }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.rowDetail, { color: t.inkFaint }]} numberOfLines={1}>
          {item.detail ?? ""}
        </Text>
      </View>
      {checked ? (
        <View style={styles.order}>
          <Pressable
            onPress={() => onMove(-1)}
            disabled={!canMoveUp}
            hitSlop={6}
            accessibilityLabel={`上移 ${item.title}`}
            style={[styles.orderKey, { opacity: canMoveUp ? 1 : 0.25 }]}
          >
            <Text style={[styles.orderText, { color: t.inkSub }]}>↑</Text>
          </Pressable>
          <Pressable
            onPress={() => onMove(1)}
            disabled={!canMoveDown}
            hitSlop={6}
            accessibilityLabel={`下移 ${item.title}`}
            style={[styles.orderKey, { opacity: canMoveDown ? 1 : 0.25 }]}
          >
            <Text style={[styles.orderText, { color: t.inkSub }]}>↓</Text>
          </Pressable>
        </View>
      ) : null}
      <Switch
        value={checked}
        onValueChange={onToggle}
        trackColor={{ false: t.hairline, true: t.brandSoft }}
        thumbColor={checked ? t.brand : t.card}
      />
    </View>
  );
}

function GroupCard({
  title,
  items,
  ids,
  onToggle,
  onMove,
}: {
  title: string;
  items: readonly ComposerCatalogItem[];
  ids: readonly string[];
  onToggle: (id: string, checked: boolean) => void;
  onMove: (id: string, delta: -1 | 1) => void;
}) {
  const t = useNibiTheme();
  if (items.length === 0) return null;
  const selected = ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is ComposerCatalogItem => Boolean(item));
  const rest = items.filter((item) => !ids.includes(item.id));
  const ordered = [...selected, ...rest];
  return (
    <View style={styles.groupCard}>
      <Text style={[styles.groupTitle, { color: t.inkFaint }]}>{title}</Text>
      <View style={[styles.group, { backgroundColor: t.card, borderColor: t.hairline }]}>
        {ordered.map((item, index) => {
          const position = ids.indexOf(item.id);
          return (
            <ToggleRow
              key={item.id}
              item={item}
              checked={position >= 0}
              onToggle={(checked) => onToggle(item.id, checked)}
              onMove={(delta) => onMove(item.id, delta)}
              canMoveUp={position > 0}
              canMoveDown={position >= 0 && position < selected.length - 1}
              last={index === ordered.length - 1}
            />
          );
        })}
      </View>
    </View>
  );
}


export default function ComposerSettingsScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const { catalog, loading } = useComposerCatalog();
  const preferences = useComposerPreferences(catalog);

  const update = (mutate: (draft: ComposerPreferences) => void) => {
    if (!preferences) return;
    const next: ComposerPreferences = {
      ...preferences,
      capsules: [...preferences.capsules],
      plus: Object.fromEntries(
        Object.entries(preferences.plus).map(([key, value]) => [key, [...value]]),
      ) as ComposerPreferences["plus"],
      messageActions: [...preferences.messageActions],
    };
    mutate(next);
    void saveComposerPreferences(next);
  };

  const capsules = catalog.filter(capsuleEligible);
  const messageItems = catalog.filter(messageEligible);

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={[styles.head, { borderBottomColor: t.hairline }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="返回"
          style={[styles.back, { backgroundColor: t.panel }]}
        >
          <Icon name="chevron-left" size={16} color={t.inkSub} />
        </Pressable>
        <Text style={[styles.title, { color: t.ink }]}>COMPOSE 快捷动作</Text>
        <View style={styles.back} />
      </View>

      {loading || !preferences ? (
        <View style={styles.loading}>
          <ActivityIndicator color={t.brand} />
          <Text style={[styles.loadingText, { color: t.inkFaint }]}>正在读取目录…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
          <Text style={[styles.intro, { color: t.inkSub }]}>
            胶囊是快捷触发；加号是完整列表；长按消息是“引用这条消息后触发命令/技能”。三处都能在这里启用和排序。
          </Text>

          <GroupCard
            title="COMPOSE 上方胶囊（快捷触发）"
            items={capsules}
            ids={preferences.capsules}
            onToggle={(id, checked) =>
              update((draft) => {
                draft.capsules = toggleInList(draft.capsules, id, checked);
              })
            }
            onMove={(id, delta) =>
              update((draft) => {
                draft.capsules = moveInList(draft.capsules, id, delta);
              })
            }
          />

          {PLUS_GROUPS.map(({ group, title }) => {
            const items = catalog.filter((item) => item.group === group);
            if (items.length === 0) return null;
            const nibi = items.filter((item) => item.source === "nibi");
            const plugin = items.filter((item) => item.source === "plugin");
            const split = group === "plugin-command" || group === "plugin" || group === "skill";
            const ids = preferences.plus[group];
            const nibiIds = ids.filter((id) => nibi.some((item) => item.id === id));
            const pluginIds = ids.filter((id) => plugin.some((item) => item.id === id));
            return (
              <View key={group} style={styles.plusSection}>
                <Text style={[styles.sectionTitle, { color: t.ink }]}>加号菜单 · {title}</Text>
                {split ? (
                  nibi.length > 0 ? (
                    <GroupCard
                      title="NIBI"
                      items={nibi}
                      ids={nibiIds}
                      onToggle={(id, checked) =>
                        update((draft) => {
                          draft.plus[group] = toggleInList(draft.plus[group], id, checked);
                        })
                      }
                      onMove={(id, delta) =>
                        update((draft) => {
                          draft.plus[group] = moveInList(draft.plus[group], id, delta);
                        })
                      }
                    />
                  ) : null
                ) : (
                  <GroupCard
                    title={title}
                    items={items}
                    ids={ids}
                    onToggle={(id, checked) =>
                      update((draft) => {
                        draft.plus[group] = toggleInList(draft.plus[group], id, checked);
                      })
                    }
                    onMove={(id, delta) =>
                      update((draft) => {
                        draft.plus[group] = moveInList(draft.plus[group], id, delta);
                      })
                    }
                  />
                )}
                {split && plugin.length > 0 ? (
                  <GroupCard
                    title="用户插件"
                    items={plugin}
                    ids={pluginIds}
                    onToggle={(id, checked) =>
                      update((draft) => {
                        draft.plus[group] = toggleInList(draft.plus[group], id, checked);
                      })
                    }
                    onMove={(id, delta) =>
                      update((draft) => {
                        draft.plus[group] = moveInList(draft.plus[group], id, delta);
                      })
                    }
                  />
                ) : null}
              </View>
            );
          })}

          <GroupCard
            title="长按消息菜单（内置「注释」始终保留）"
            items={messageItems}
            ids={preferences.messageActions}
            onToggle={(id, checked) =>
              update((draft) => {
                draft.messageActions = toggleInList(draft.messageActions, id, checked);
              })
            }
            onMove={(id, delta) =>
              update((draft) => {
                draft.messageActions = moveInList(draft.messageActions, id, delta);
              })
            }
          />

          <Text style={[styles.footnote, { color: t.inkGhost }]}>
            开关只影响显示；动作是否执行仍由内核权限/审批与插件能力决定。新安装的插件/技能会自动出现在对应分组末尾。
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, textAlign: "center", fontSize: typeScale.heading, fontWeight: "700" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: space(2) },
  loadingText: { fontSize: 11 },
  body: { padding: space(4), gap: space(4) },
  intro: { fontSize: 12, lineHeight: 18 },
  sectionTitle: { fontSize: 13, fontWeight: "700", paddingLeft: space(1) },
  plusSection: { gap: space(2) },
  groupCard: { gap: space(1.5) },
  groupTitle: { fontSize: 10, fontWeight: "700", paddingLeft: space(1) },
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
    minHeight: 54,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 12.5, fontWeight: "600" },
  rowDetail: { fontSize: 9.5 },
  order: { flexDirection: "row", alignItems: "center", gap: 2 },
  orderKey: { width: 20, height: 24, alignItems: "center", justifyContent: "center" },
  orderText: { fontSize: 13, fontWeight: "700" },
  footnote: { fontSize: 10, lineHeight: 15 },
});