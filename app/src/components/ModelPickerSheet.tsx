// 会话里的模型选择器：供应商 → 模型 → 思考强度。
//
// 选择只改“下一条消息”的草稿，不立刻改运行中的会话；发送时由 sendText 一起提交。
// 模型能力（视觉/思考档位）来自内核 provider/state 的 modelInfo。
// 2.0：底座换成 ui/Sheet（底部滑入 + 统一遮罩），供应商/模型行/底部按钮走
// PressableScale + PillButton；选择逻辑不变。ThinkingRail 仍由另一位同事另行重绘。

import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import { PillButton } from "./ui/PillButton";
import { Sheet } from "./ui/Sheet";
import { ThinkingRail, thinkingLevelLabel } from "./ThinkingRail";
import { useI18n } from "../i18n";
import type { ProviderModelConfig, ProviderSummary } from "../kernel/providerSettings";
import { PressableScale } from "../motion/PressableScale";
import { radius, size, space, text, useNibiTheme } from "../theme";

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
  const { pick, locale } = useI18n();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [levels, locale],
  );

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightRatio={0.84}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={styles.headTextCol}>
            <Text style={[styles.title, { color: t.ink }]}>{pick("选择模型", "Select model")}</Text>
            <Text style={[styles.sub, { color: t.inkSub }]}>
              {pick("选择只作用于下一条消息", "Applies to your next message")}
            </Text>
          </View>
          <PressableScale
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={pick("关闭", "Close")}
            style={[
              styles.close,
              { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
            ]}
          >
            <Icon name="x" size={15} color={t.inkSub} />
          </PressableScale>
        </View>

        {providers.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: t.inkSub }]}>
              {pick("还没有可用的模型服务。", "No model providers available yet.")}
            </Text>
            <PillButton label={pick("去设置模型", "Configure models")} onPress={onManage} />
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
                  <PressableScale
                    key={entry.id}
                    scaleTo={0.94}
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
                    accessibilityLabel={pick(`模型服务 ${entry.name}`, `Provider ${entry.name}`)}
                    style={({ pressed }) => [
                      styles.providerChip,
                      {
                        backgroundColor: active
                          ? t.brandSoft
                          : pressed
                            ? t.hover
                            : t.surfaceSoft,
                        borderColor: active ? t.brand : t.hairline,
                      },
                    ]}
                  >
                    <Icon name="monitor" size={12} color={active ? t.brand : t.inkSub} />
                    <Text
                      style={[
                        styles.providerText,
                        {
                          color: active ? t.brand : t.inkSub,
                          fontWeight: active ? "700" : "600",
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {entry.name}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>

            <ScrollView style={styles.models} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {provider?.models.length === 0 ? (
                <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                  {pick(
                    "这个服务还没有模型；在设置里添加模型 ID。",
                    "No models for this provider yet; add a model ID in Settings.",
                  )}
                </Text>
              ) : null}
              {provider?.models.map((modelId) => {
                const config = modelInfo(provider, modelId);
                const active =
                  provider.id === selection?.providerId && modelId === selection?.modelId;
                const context = contextLabel(config);
                return (
                  <PressableScale
                    key={modelId}
                    scaleTo={0.985}
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
                        backgroundColor: active
                          ? t.brandSoft
                          : pressed
                            ? t.hover
                            : t.surfaceSoft,
                        borderColor: active ? t.brand : t.hairline,
                      },
                    ]}
                  >
                    <View style={styles.modelText}>
                      <Text
                        style={[
                          styles.modelName,
                          {
                            color: t.ink,
                            fontWeight: active ? "700" : "600",
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {modelId}
                      </Text>
                      {context || supportsVision(config) ? (
                        <View style={styles.modelMeta}>
                          {context ? (
                            <View
                              style={[
                                styles.metaChip,
                                { backgroundColor: t.card, borderColor: t.hairline },
                              ]}
                            >
                              <Text style={[styles.metaText, { color: t.inkSub }]}>{context}</Text>
                            </View>
                          ) : null}
                          {supportsVision(config) ? (
                            <View
                              style={[
                                styles.metaChip,
                                { backgroundColor: t.card, borderColor: t.hairline },
                              ]}
                            >
                              <Text style={[styles.metaText, { color: t.steel }]}>
                                {pick("视觉", "Vision")}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                    {active ? (
                      <View style={[styles.checkBadge, { backgroundColor: t.brand }]}>
                        <Icon name="check" size={12} color={t.brandFg} />
                      </View>
                    ) : null}
                  </PressableScale>
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
              <PillButton
                variant="secondary"
                label={pick("管理模型", "Manage models")}
                onPress={onManage}
              />
              <PillButton label={pick("完成", "Done")} onPress={onClose} />
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Sheet 自身只负责定位/遮罩/安全区，内容内边距由这里补齐。
  sheet: {
    paddingHorizontal: space(4),
    paddingTop: space(1.5),
    paddingBottom: space(3),
    gap: space(2.5),
    flexShrink: 1,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headTextCol: { flex: 1, gap: 2 },
  title: { ...text("heading"), fontWeight: "700" },
  sub: { ...text("micro") },
  close: {
    width: size.chipLg,
    height: size.chipLg,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  providers: { gap: space(2), paddingVertical: 2 },
  providerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    height: size.chipLg,
    maxWidth: 160,
  },
  providerText: { ...text("micro"), fontWeight: "600", flexShrink: 1 },
  models: { flexGrow: 0, flexShrink: 1, maxHeight: 280 },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    minHeight: 52,
    marginBottom: space(1.5),
  },
  modelText: { flex: 1, gap: 4 },
  modelName: { ...text("body"), fontWeight: "600" },
  modelMeta: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  metaChip: {
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(2),
    paddingVertical: 1,
  },
  metaText: { ...text("micro"), fontWeight: "600" },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  effort: { paddingTop: space(0.5) },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: space(1) },
  empty: { gap: space(3), paddingVertical: space(4), alignItems: "center" },
  emptyText: { ...text("small"), textAlign: "center" },
});
