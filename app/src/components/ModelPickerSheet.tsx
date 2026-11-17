// 会话里的模型选择器：供应商 → 模型 → 思考强度。
//
// 选择只改“下一条消息”的草稿，不立刻改运行中的会话；发送时由 sendText 一起提交。
// 模型能力（视觉/思考档位）来自内核 provider/state 的 modelInfo。

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { ThinkingRail, thinkingLevelLabel } from "./ThinkingRail";
import type {
  ProviderModelConfig,
  ProviderState,
  ProviderSummary,
} from "../kernel/providerSettings";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

export interface ModelChoice {
  providerId: string;
  modelId: string;
  reasoningLevel?: string;
}

function levelsOf(config: ProviderModelConfig | undefined): string[] {
  return config?.optionSpecs?.reasoningLevel?.values?.filter(Boolean) ?? [];
}

function supportsVision(config: ProviderModelConfig | undefined): boolean {
  return config?.properties?.inputFormat?.supportsImage === true;
}

function contextLabel(config: ProviderModelConfig | undefined): string | null {
  const window = config?.properties?.contextWindow;
  if (!window) return null;
  if (window >= 1_000_000) return `${Math.round(window / 100_000) / 10}M`;
  if (window >= 1000) return `${Math.round(window / 1000)}K`;
  return String(window);
}

function modelInfo(provider: ProviderSummary, modelId: string): ProviderModelConfig | undefined {
  return provider.modelInfo?.find((model) => model.id === modelId)?.config;
}

export function ModelPickerSheet({
  visible,
  providers,
  selection,
  onSelect,
  onClose,
  onManage,
}: {
  visible: boolean;
  providers: readonly ProviderSummary[];
  selection: ModelChoice | null;
  onSelect: (choice: ModelChoice) => void;
  onClose: () => void;
  onManage: () => void;
}) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const [providerId, setProviderId] = useState(selection?.providerId ?? "");

  useEffect(() => {
    if (visible) setProviderId(selection?.providerId ?? providers[0]?.id ?? "");
  }, [providers, selection?.providerId, visible]);

  const provider = useMemo(
    () => providers.find((candidate) => candidate.id === providerId) ?? providers[0],
    [providerId, providers],
  );
  const currentConfig = selection && provider?.id === selection.providerId
    ? modelInfo(provider, selection.modelId)
    : undefined;
  const levels = levelsOf(currentConfig);
  const effort = useMemo(
    () => levels.map((value) => ({ value, label: thinkingLevelLabel(value) })),
    [levels],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="关闭模型选择" />
        <View
          style={[
            styles.card,
            {
              backgroundColor: t.card,
              borderColor: t.hairline,
              paddingBottom: insets.bottom + space(4),
            },
          ]}
        >
          <View style={styles.head}>
            <View>
              <Text style={[styles.title, { color: t.ink }]}>选择模型</Text>
              <Text style={[styles.sub, { color: t.inkFaint }]}>
                选择只作用于下一条消息
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="关闭">
              <Icon name="x" size={16} color={t.inkSub} />
            </Pressable>
          </View>

          {providers.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: t.inkSub }]}>还没有可用的模型供应商。</Text>
              <Pressable
                onPress={onManage}
                style={[styles.primary, { backgroundColor: t.brand }]}
              >
                <Text style={[styles.primaryText, { color: t.brandFg }]}>去设置模型</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.providers}
              >
                {providers.map((entry) => {
                  const active = entry.id === provider?.id;
                  return (
                    <Pressable
                      key={entry.id}
                      onPress={() => {
                        setProviderId(entry.id);
                        const modelId = entry.models[0];
                        if (modelId) {
                          const config = modelInfo(entry, modelId);
                          const levels = levelsOf(config);
                          onSelect({
                            providerId: entry.id,
                            modelId,
                            ...(levels.length > 0
                              ? { reasoningLevel: levels[levels.length - 1] }
                              : {}),
                          });
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`供应商 ${entry.name}`}
                      style={[
                        styles.providerChip,
                        {
                          backgroundColor: active ? t.brandSoft : t.panel,
                          borderColor: active ? t.brand : t.hairline,
                        },
                      ]}
                    >
                      <Icon name="monitor" size={12} color={active ? t.brand : t.inkSub} />
                      <Text
                        style={[
                          styles.providerText,
                          { color: active ? t.brand : t.inkSub },
                        ]}
                        numberOfLines={1}
                      >
                        {entry.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <ScrollView style={styles.models} nestedScrollEnabled>
                {provider?.models.length === 0 ? (
                  <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                    这个供应商还没有模型；在设置里添加模型 ID。
                  </Text>
                ) : null}
                {provider?.models.map((modelId) => {
                  const config = modelInfo(provider, modelId);
                  const active =
                    provider.id === selection?.providerId && modelId === selection?.modelId;
                  const context = contextLabel(config);
                  return (
                    <Pressable
                      key={modelId}
                      onPress={() => {
                        const nextLevels = levelsOf(config);
                        onSelect({
                          providerId: provider.id,
                          modelId,
                          ...(nextLevels.length > 0
                            ? { reasoningLevel: nextLevels[nextLevels.length - 1] }
                            : {}),
                        });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={modelId}
                      style={({ pressed }) => [
                        styles.modelRow,
                        {
                          backgroundColor: active ? t.brandSoft : "transparent",
                          borderColor: t.hairline,
                          opacity: pressed ? 0.65 : 1,
                        },
                      ]}
                    >
                      <View style={styles.modelText}>
                        <Text style={[styles.modelName, { color: t.ink }]} numberOfLines={1}>
                          {modelId}
                        </Text>
                        <View style={styles.modelMeta}>
                          {context ? (
                            <Text style={[styles.metaText, { color: t.inkFaint }]}>{context}</Text>
                          ) : null}
                          {supportsVision(config) ? (
                            <View style={[styles.visionBadge, { backgroundColor: t.steelSoft }]}>
                              <Text style={[styles.visionText, { color: t.steel }]}>视觉</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      {active ? <Icon name="check" size={14} color={t.brand} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>

              {effort.length > 1 && selection ? (
                <View style={styles.effort}>
                  <ThinkingRail
                    levels={effort}
                    value={selection.reasoningLevel ?? effort[effort.length - 1]!.value}
                    onChange={(reasoningLevel) =>
                      onSelect({ ...selection, reasoningLevel })
                    }
                  />
                </View>
              ) : null}

              <View style={styles.foot}>
                <Pressable onPress={onManage} accessibilityRole="button" accessibilityLabel="管理模型">
                  <Text style={[styles.manage, { color: t.inkSub }]}>管理模型</Text>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  style={[styles.done, { backgroundColor: t.brand }]}
                >
                  <Text style={[styles.doneText, { color: t.brandFg }]}>完成</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(20,26,36,0.26)",
  },
  card: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(4),
    paddingTop: space(3),
    gap: space(2),
    maxHeight: "84%",
  },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title: { fontSize: typeScale.heading, fontWeight: "700" },
  sub: { fontSize: 10, marginTop: 2 },
  providers: { gap: space(1.5), paddingVertical: 2 },
  providerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    height: 28,
    maxWidth: 150,
  },
  providerText: { fontSize: 10.5, fontWeight: "600", flexShrink: 1 },
  models: { maxHeight: 280 },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
    minHeight: 48,
  },
  modelText: { flex: 1, gap: 1 },
  modelName: { fontSize: 12.5, fontWeight: "600" },
  modelMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 9.5 },
  visionBadge: { borderRadius: radius.chip, paddingHorizontal: 5, paddingVertical: 1 },
  visionText: { fontSize: 9, fontWeight: "700" },
  effort: { paddingTop: space(1) },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  manage: { fontSize: 11.5, fontWeight: "600" },
  done: { borderRadius: radius.chip, paddingHorizontal: space(4), paddingVertical: space(2) },
  doneText: { fontSize: 12, fontWeight: "700" },
  empty: { gap: space(2), paddingVertical: space(4), alignItems: "center" },
  emptyText: { fontSize: 11.5, textAlign: "center" },
  primary: { borderRadius: radius.chip, paddingHorizontal: space(4), paddingVertical: space(2) },
  primaryText: { fontSize: 12, fontWeight: "700" },
});