// COMPOSE 配置：胶囊快捷动作、加号菜单、长按消息菜单。
//
// 统一的目录（catalog）来自 NIBI 原生命令 + 插件命令/插件卡片 + 本机/插件技能；
// 这里只改启用与顺序，动作语义由 catalog 的 token 决定。
// 2.0：ScreenHeader + SectionCard 统一；开关行走 ui/Row——右槽要同时放排序钮和开关，
// ui/ToggleRow（右槽固定是 Switch）容不下，所以用 Row + right 组合而不是第三份 ToggleRow。

import { router } from "expo-router";
import { Fragment, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "../../components/Icon";
import { Row } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
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
import { AppearIn, staggerDelay } from "../../motion/appear";
import { PressableScale } from "../../motion/PressableScale";
import { size, space, text, useNibiTheme } from "../../theme";

/** 行内排序钮：上/下移。图标集没有 chevron-up，用 chevron-down 转 180° 当上箭头。 */
function OrderKey({
  up,
  title,
  onPress,
  disabled,
}: {
  up: boolean;
  title: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const th = useNibiTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityLabel={title}
      style={styles.orderKey}
    >
      <View style={up ? styles.orderUp : undefined}>
        <Icon name="chevron-down" size={13} color={disabled ? th.inkGhost : th.inkSub} />
      </View>
    </PressableScale>
  );
}

/** 行右槽：选中项才有排序钮；开关样式与 ui/ToggleRow 同一配置。 */
function RowRight({
  checked,
  title,
  onToggle,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  checked: boolean;
  title: string;
  onToggle: (checked: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const th = useNibiTheme();
  return (
    <View style={styles.rowRight}>
      {checked ? (
        <>
          <OrderKey up title={`上移 ${title}`} onPress={() => onMove(-1)} disabled={!canMoveUp} />
          <OrderKey up={false} title={`下移 ${title}`} onPress={() => onMove(1)} disabled={!canMoveDown} />
        </>
      ) : null}
      <Switch
        value={checked}
        onValueChange={onToggle}
        trackColor={{ false: th.surfaceSoft, true: th.brandSoft }}
        thumbColor={checked ? th.brand : th.inkGhost}
        ios_backgroundColor={th.surfaceSoft}
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
  if (items.length === 0) return null;
  const selected = ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is ComposerCatalogItem => Boolean(item));
  const rest = items.filter((item) => !ids.includes(item.id));
  const ordered = [...selected, ...rest];
  return (
    <SectionCard label={title}>
      {ordered.map((item, index) => {
        const position = ids.indexOf(item.id);
        return (
          <Fragment key={item.id}>
            {index > 0 ? <Divider /> : null}
            <Row
              icon={(item.icon ?? "puzzle") as IconName}
              tone="plain"
              title={item.title}
              detail={item.detail ?? ""}
              right={
                <RowRight
                  checked={position >= 0}
                  title={item.title}
                  onToggle={(checked) => onToggle(item.id, checked)}
                  onMove={(delta) => onMove(item.id, delta)}
                  canMoveUp={position > 0}
                  canMoveDown={position >= 0 && position < selected.length - 1}
                />
              }
            />
          </Fragment>
        );
      })}
    </SectionCard>
  );
}

export default function ComposerSettingsScreen() {
  const th = useNibiTheme();
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
    <View style={styles.root}>
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="COMPOSE 快捷动作" onBack={() => router.back()} />

      {loading || !preferences ? (
        <View style={styles.loading}>
          <ActivityIndicator color={th.brand} />
          <Text style={[styles.loadingText, { color: th.inkFaint }]}>正在读取目录…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
          <AppearIn delay={staggerDelay(0, 32, 240)}>
            <Text style={[styles.intro, { color: th.inkSub }]}>
              胶囊是快捷触发；加号是完整列表；长按消息是“引用这条消息后触发命令/技能”。三处都能在这里启用和排序。
            </Text>
          </AppearIn>

          <AppearIn delay={staggerDelay(1, 32, 240)}>
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
          </AppearIn>

          {PLUS_GROUPS.map(({ group, title }, groupIndex) => {
            const items = catalog.filter((item) => item.group === group);
            if (items.length === 0) return null;
            const nibi = items.filter((item) => item.source === "nibi");
            const plugin = items.filter((item) => item.source === "plugin");
            const split = group === "plugin-command" || group === "plugin" || group === "skill";
            const ids = preferences.plus[group];
            const nibiIds = ids.filter((id) => nibi.some((item) => item.id === id));
            const pluginIds = ids.filter((id) => plugin.some((item) => item.id === id));
            return (
              <AppearIn key={group} delay={staggerDelay(groupIndex + 2, 32, 240)}>
                <View style={styles.plusSection}>
                  <Text style={[styles.sectionTitle, { color: th.ink }]}>加号菜单 · {title}</Text>
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
              </AppearIn>
            );
          })}

          <AppearIn delay={staggerDelay(PLUS_GROUPS.length + 2, 32, 240)}>
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
          </AppearIn>

          <AppearIn delay={staggerDelay(PLUS_GROUPS.length + 3, 32, 240)}>
            <Text style={[styles.footnote, { color: th.inkGhost }]}>
              开关只影响显示；动作是否执行仍由内核权限/审批与插件能力决定。新安装的插件/技能会自动出现在对应分组末尾。
            </Text>
          </AppearIn>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: space(2) },
  loadingText: { ...text("small") },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(4) },
  intro: { ...text("small") },
  sectionTitle: { ...text("body"), fontWeight: "700" },
  plusSection: { gap: space(2) },
  rowRight: { flexDirection: "row", alignItems: "center", gap: space(0.5) },
  orderKey: {
    width: size.chip,
    height: size.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  orderUp: { transform: [{ rotate: "180deg" }] },
  footnote: { ...text("micro") },
});
