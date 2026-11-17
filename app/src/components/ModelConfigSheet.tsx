// 添加/编辑模型：模型 ID → 智能匹配内置配置 → 可改上下文、模态、能力、思考档位。
//
// 保存的是完整生效配置（由内核 provider/resolveModel 解析后填好），写进 providerModelRules；
// 这样即使内置目录以后更新，这个模型的行为也不会在用户不知情时漂移。

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import type {
  ProviderModelConfig,
  ProviderSummary,
} from "../kernel/providerSettings";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

function numberValue(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

function levelsText(config: ProviderModelConfig | undefined): string {
  return (config?.optionSpecs?.reasoningLevel?.values ?? []).join(", ");
}

function mapText(config: ProviderModelConfig | undefined): string {
  return config?.optionSpecs?.reasoningLevel?.map ?? "";
}

export interface ModelDraft {
  modelId: string;
  contextWindow: string;
  maxOutputTokens: string;
  supportsImage: boolean;
  supportsVideo: boolean;
  supportsPdf: boolean;
  supportsJsonSchemaOutput: boolean;
  supportsNativeWebSearch: boolean;
  supportsMidConversationSystem: boolean;
  reasoningLevels: string;
  reasoningMap: string;
}

function draftFrom(
  modelId: string,
  config: ProviderModelConfig | undefined,
): ModelDraft {
  const input = config?.properties?.inputFormat;
  return {
    modelId,
    contextWindow: numberValue(config?.properties?.contextWindow),
    maxOutputTokens: numberValue(config?.optionSpecs?.maxOutputTokens?.max),
    supportsImage: input?.supportsImage === true,
    supportsVideo: input?.supportsVideo === true,
    supportsPdf: input?.supportsPdf === true,
    supportsJsonSchemaOutput: config?.properties?.supportsJsonSchemaOutput === true,
    supportsNativeWebSearch: config?.properties?.supportsNativeWebSearch === true,
    supportsMidConversationSystem:
      config?.properties?.supportsMidConversationSystem === true,
    reasoningLevels: levelsText(config),
    reasoningMap: mapText(config),
  };
}

function buildConfig(draft: ModelDraft, base: ProviderModelConfig | undefined): ProviderModelConfig {
  const contextWindow = Number.parseInt(draft.contextWindow, 10);
  const maxOutputTokens = Number.parseInt(draft.maxOutputTokens, 10);
  const levels = draft.reasoningLevels
    .split(/[,\n]/u)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    enabled: true,
    properties: {
      ...(Number.isFinite(contextWindow) ? { contextWindow } : {}),
      inputFormat: {
        supportsText: true,
        supportsImage: draft.supportsImage,
        supportsVideo: draft.supportsVideo,
        supportsAudio: base?.properties?.inputFormat?.supportsAudio === true,
        supportsPdf: draft.supportsPdf,
      },
      outputFormat: base?.properties?.outputFormat ?? { supportsText: true },
      supportsToolCall: base?.properties?.supportsToolCall ?? true,
      supportsJsonSchemaOutput: draft.supportsJsonSchemaOutput,
      supportsNativeWebSearch: draft.supportsNativeWebSearch,
      supportsMidConversationSystem: draft.supportsMidConversationSystem,
      requiresMfjsToolSchema: base?.properties?.requiresMfjsToolSchema === true,
    },
    optionSpecs: {
      reasoningLevel: {
        values: levels.length > 0 ? levels : ["disabled", "enabled"],
        map: draft.reasoningMap.trim() || "{}",
      },
      maxOutputTokens: {
        ...(Number.isFinite(maxOutputTokens) ? { max: maxOutputTokens } : {}),
        map: base?.optionSpecs?.maxOutputTokens?.map ?? "{}",
      },
    },
  };
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  keyboardType,
  editable = true,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
  editable?: boolean;
}) {
  const t = useNibiTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: t.inkSub }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.inkFaint}
        keyboardType={keyboardType}
        editable={editable}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          { color: t.ink, borderColor: t.hairline, backgroundColor: t.panel },
        ]}
      />
      {hint ? <Text style={[styles.hint, { color: t.inkFaint }]}>{hint}</Text> : null}
    </View>
  );
}

function Toggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const t = useNibiTheme();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={[styles.toggleLabel, { color: t.ink }]}>{label}</Text>
        {detail ? <Text style={[styles.hint, { color: t.inkFaint }]}>{detail}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: t.hairline, true: t.brandSoft }}
        thumbColor={value ? t.brand : t.card}
      />
    </View>
  );
}

export function ModelConfigSheet({
  visible,
  provider,
  modelId,
  initialConfig,
  onResolve,
  onClose,
  onSave,
}: {
  visible: boolean;
  provider: ProviderSummary | null;
  modelId?: string;
  initialConfig?: ProviderModelConfig;
  onResolve: (providerId: string, modelId: string) => Promise<ProviderModelConfig>;
  onClose: () => void;
  onSave: (modelId: string, config: ProviderModelConfig) => Promise<void>;
}) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const existing = Boolean(modelId);
  const [draft, setDraft] = useState<ModelDraft>(() => draftFrom(modelId ?? "", initialConfig));
  const [smart, setSmart] = useState(!existing);
  const [resolving, setResolving] = useState(false);
  const [matched, setMatched] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(draftFrom(modelId ?? "", initialConfig));
    setSmart(!existing);
    setMatched(false);
    setNote(null);
  }, [existing, initialConfig, modelId, visible]);

  // 智能模式：模型 ID 停手 700ms 后自动匹配内置目录；关掉后只保留手动值。
  useEffect(() => {
    if (!visible || !smart || !provider) return;
    const id = draft.modelId.trim();
    if (!id || id === modelId) return;
    const timer = setTimeout(() => {
      setResolving(true);
      setNote(null);
      void onResolve(provider.id, id)
        .then((config) => {
          setDraft(draftFrom(id, config));
          setMatched(true);
        })
        .catch((cause: unknown) => {
          setNote(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => setResolving(false));
    }, 700);
    return () => clearTimeout(timer);
  }, [draft.modelId, modelId, provider, smart, visible]);

  const resolve = async () => {
    if (!provider) return;
    const id = draft.modelId.trim();
    if (!id) {
      setNote("先填模型 ID");
      return;
    }
    setResolving(true);
    setNote(null);
    try {
      const config = await onResolve(provider.id, id);
      setDraft((current) => ({
        ...draftFrom(id, config),
        // 用户已经手改的字段在智能模式下仍保留？移动端简化：重新匹配时以推荐值为准。
      }));
      setMatched(true);
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResolving(false);
    }
  };

  const save = async () => {
    const id = draft.modelId.trim();
    if (!id) {
      setNote("模型 ID 不能为空");
      return;
    }
    const levels = draft.reasoningLevels
      .split(/[,\n]/u)
      .map((value) => value.trim())
      .filter(Boolean);
    if (levels.length === 0) {
      setNote("至少保留一个思考档位");
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      await onSave(id, buildConfig(draft, initialConfig));
      onClose();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="关闭模型配置" />
        <View
          style={[
            styles.card,
            {
              backgroundColor: t.card,
              borderColor: t.hairline,
              paddingBottom: insets.bottom + space(3),
            },
          ]}
        >
          <View style={styles.head}>
            <View>
              <Text style={[styles.title, { color: t.ink }]}>
                {existing ? "编辑模型" : "添加模型"}
              </Text>
              <Text style={[styles.sub, { color: t.inkFaint }]}>
                {provider?.name ?? "未选择供应商"}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="关闭">
              <Icon name="x" size={16} color={t.inkSub} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <View style={[styles.smartCard, { backgroundColor: t.panel, borderColor: t.hairline }]}>
              <View style={styles.smartHead}>
                <View style={styles.smartText}>
                  <Text style={[styles.smartTitle, { color: t.ink }]}>智能配置</Text>
                  <Text style={[styles.hint, { color: t.inkFaint }]}>
                    按模型名匹配内置目录：上下文、模态、思考档位与参数映射
                  </Text>
                </View>
                <Switch
                  value={smart}
                  onValueChange={setSmart}
                  trackColor={{ false: t.hairline, true: t.brandSoft }}
                  thumbColor={smart ? t.brand : t.card}
                />
              </View>
              <View style={styles.resolveRow}>
                <Pressable
                  onPress={() => void resolve()}
                  disabled={resolving}
                  style={[styles.resolveButton, { backgroundColor: t.brandSoft }]}
                >
                  {resolving ? (
                    <ActivityIndicator size="small" color={t.brand} />
                  ) : (
                    <Icon name="sparkles" size={13} color={t.brand} />
                  )}
                  <Text style={[styles.resolveText, { color: t.brand }]}>
                    {resolving ? "匹配中…" : "按模型名匹配"}
                  </Text>
                </Pressable>
                {matched ? (
                  <View style={[styles.matched, { backgroundColor: t.okSoft }]}>
                    <Icon name="check" size={11} color={t.ok} />
                    <Text style={[styles.matchedText, { color: t.ok }]}>已匹配内置配置</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <Field
              label="模型 ID"
              value={draft.modelId}
              onChange={(modelId) => setDraft({ ...draft, modelId })}
              placeholder="deepseek-v4.1-flash"
              editable={!existing}
              hint={existing ? "模型 ID 已保存，不能在原位置改名；需要新 ID 请新增模型。" : undefined}
            />
            <View style={styles.twoCols}>
              <View style={styles.col}>
                <Field
                  label="上下文窗口"
                  value={draft.contextWindow}
                  onChange={(contextWindow) => setDraft({ ...draft, contextWindow })}
                  placeholder="128000"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.col}>
                <Field
                  label="最大输出 Token"
                  value={draft.maxOutputTokens}
                  onChange={(maxOutputTokens) => setDraft({ ...draft, maxOutputTokens })}
                  placeholder="8192"
                  keyboardType="numeric"
                />
              </View>
            </View>

            <Text style={[styles.section, { color: t.inkFaint }]}>输入类型</Text>
            <View style={styles.chips}>
              <View style={[styles.chip, styles.chipFixed, { backgroundColor: t.brandSoft, borderColor: t.brandSoft }]}>
                <Text style={[styles.chipText, { color: t.brand }]}>文本</Text>
              </View>
              {[
                ["图片", "supportsImage"],
                ["视频", "supportsVideo"],
                ["PDF", "supportsPdf"],
              ].map(([label, key]) => {
                const value = draft[key as "supportsImage" | "supportsVideo" | "supportsPdf"];
                return (
                  <Pressable
                    key={key}
                    onPress={() => setDraft({ ...draft, [key]: !value })}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: value ? t.brandSoft : t.panel,
                        borderColor: value ? t.brand : t.hairline,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: value ? t.brand : t.inkSub }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.section, { color: t.inkFaint }]}>模型能力</Text>
            <View style={[styles.group, { borderColor: t.hairline }]}>
              <Toggle
                label="结构化输出"
                value={draft.supportsJsonSchemaOutput}
                onChange={(supportsJsonSchemaOutput) =>
                  setDraft({ ...draft, supportsJsonSchemaOutput })
                }
              />
              <Toggle
                label="原生联网搜索"
                value={draft.supportsNativeWebSearch}
                onChange={(supportsNativeWebSearch) =>
                  setDraft({ ...draft, supportsNativeWebSearch })
                }
              />
              <Toggle
                label="对话中间系统消息"
                value={draft.supportsMidConversationSystem}
                onChange={(supportsMidConversationSystem) =>
                  setDraft({ ...draft, supportsMidConversationSystem })
                }
              />
            </View>

            <Field
              label="思考档位（从低到高，逗号分隔）"
              value={draft.reasoningLevels}
              onChange={(reasoningLevels) => setDraft({ ...draft, reasoningLevels })}
              placeholder="disabled, low, high, max"
              hint="档位数量由模型决定，不固定为 3 或 4 档。"
            />
            <Field
              label="思考参数映射（JSON/CEL 片段）"
              value={draft.reasoningMap}
              onChange={(reasoningMap) => setDraft({ ...draft, reasoningMap })}
              placeholder={'{"reasoning": {"effort": reasoningLevel}}'}
              hint="留空为 {}；具体字段由供应商协议决定。"
            />

            {note ? <Text style={[styles.note, { color: t.red }]}>{note}</Text> : null}
          </ScrollView>

          <View style={styles.foot}>
            <Pressable onPress={onClose} style={styles.cancel}>
              <Text style={{ color: t.inkSub }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => void save()}
              disabled={saving}
              style={[styles.save, { backgroundColor: t.brand, opacity: saving ? 0.55 : 1 }]}
            >
              <Text style={[styles.saveText, { color: t.brandFg }]}>
                {saving ? "保存中…" : "保存"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(20,26,36,0.26)" },
  card: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(4),
    paddingTop: space(3),
    gap: space(2),
    maxHeight: "90%",
  },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title: { fontSize: typeScale.heading, fontWeight: "700" },
  sub: { fontSize: 10, marginTop: 2 },
  body: { maxHeight: 540 },
  smartCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: space(2.5), gap: space(2) },
  smartHead: { flexDirection: "row", alignItems: "center", gap: space(2) },
  smartText: { flex: 1, gap: 2 },
  smartTitle: { fontSize: 12.5, fontWeight: "700" },
  resolveRow: { flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" },
  resolveButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    minHeight: 30,
  },
  resolveText: { fontSize: 11, fontWeight: "700" },
  matched: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: 3,
  },
  matchedText: { fontSize: 9.5, fontWeight: "600" },
  field: { gap: 4 },
  label: { fontSize: 10.5, fontWeight: "600" },
  input: {
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    fontSize: 12.5,
  },
  hint: { fontSize: 9.5, lineHeight: 14 },
  twoCols: { flexDirection: "row", gap: space(2) },
  col: { flex: 1 },
  section: { fontSize: 10, fontWeight: "700", marginTop: space(1) },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
  },
  chipFixed: { opacity: 0.9 },
  chipText: { fontSize: 11, fontWeight: "600" },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.control, overflow: "hidden" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  toggleText: { flex: 1, gap: 1 },
  toggleLabel: { fontSize: 11.5, fontWeight: "600" },
  note: { fontSize: 10.5, lineHeight: 15 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space(3) },
  cancel: { paddingVertical: space(2) },
  save: { borderRadius: radius.chip, paddingHorizontal: space(4), paddingVertical: space(2) },
  saveText: { fontSize: 12.5, fontWeight: "700" },
});