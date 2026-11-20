// 设置页：模型 Provider 的配置（D25 可用性收口）。
//
// 配置写内核的 `provider_config.json`（与桌面/CLI 同一份）；API key 存 Android Keystore
// （expo-secure-store），保存后经 `provider/setKeys` 只送进内核内存，不落配置文件。
// 2.0：ScreenHeader 统一头部；供应商卡改 SectionCard 容器 + 发丝分隔；
// 表单按钮/供应商动作统一 PillButton；输入井用 surfaceSoft。
// 供应商头与模型行保留 ProviderLogo/MonogramAvatar（自定义头像没法塞 ui/Row 的 IconName 图标槽），
// 行距/字阶/徽标全部走 token。
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../../components/Icon";
import { MonogramAvatar } from "../../components/ProviderAvatar";
import { ProviderLogo } from "../../components/ProviderLogo";
import { PillButton } from "../../components/ui/PillButton";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";

import { KernelSessionClient } from "@nibi-go/kernel-session";

import {
  kernelHostAvailable,
  onKernelLine,
  sendKernelLine,
  startKernelHost,
} from "nibi-kernel-host";
import { ModelConfigSheet } from "../../components/ModelConfigSheet";
import {
  fetchProviderState,
  PROVIDER_PROTOCOLS,
  resolveProviderModel,
  removeProvider,
  saveProvider,
  setDefaultProvider,
  testProvider,
  type ModelSelection,
  type ProviderDraft,
  type ProviderModelConfig,
  type ProviderPreset,
  type ProviderProtocol,
  type ProviderState,
  type ProviderSummary,
} from "../../kernel/providerSettings";
import { kernelStartEnv } from "../../kernel/kernelEnv";
import {
  loadProviderKeys,
  providerKeysEnv,
  pushProviderKeys,
  removeProviderKey,
  setProviderKey,
} from "../../kernel/providerKeys";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { PressableScale } from "../../motion/PressableScale";
import { radius, size, space, text, useNibiTheme } from "../../theme";

interface EditingState {
  providerId?: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  models: string;
  template?: string;
  enabled: boolean;
}

const EMPTY_DRAFT: EditingState = {
  name: "",
  baseUrl: "",
  protocol: "openai-chat-completions",
  models: "",
  enabled: true,
};

function protocolLabel(protocol: ProviderProtocol | undefined): string {
  switch (protocol) {
    case "anthropic-messages":
      return "Anthropic Messages";
    case "openai-responses":
      return "OpenAI Responses";
    case "openai-chat-completions":
      return "OpenAI Chat";
    default:
      return "未配置协议";
  }
}

function modelsOf(draft: EditingState): string[] {
  return draft.models
    .split(/[,\n]/u)
    .map((model) => model.trim())
    .filter(Boolean);
}

/** 状态徽标：soft 底 + 对应色文字（默认/Key/账号/视觉/PDF 统一走这一处）。 */
function StatusPill({ bg, color, label }: { bg: string; color: string; label: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export default function SettingsScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const clientRef = useRef<KernelSessionClient | null>(null);
  const [state, setState] = useState<ProviderState>({ providers: [], presets: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [presetQuery, setPresetQuery] = useState("");
  const [modelEditor, setModelEditor] = useState<{
    provider: ProviderSummary;
    modelId?: string;
    config?: ProviderModelConfig;
  } | null>(null);

  const client = useCallback((): KernelSessionClient => {
    if (!clientRef.current) throw new Error("内核尚未就绪");
    return clientRef.current;
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchProviderState(client());
      setState(next);
      setKeys(await loadProviderKeys());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 设置页可能从冷启动直接进入：服务模式是幂等的，已在跑时 start 直接返回 true。
      const env = { ...((await kernelStartEnv()) ?? {}), ...(await providerKeysEnv()) };
      const startEnv = Object.keys(env).length > 0 ? env : undefined;
      const started =
        (await startKernelHost(startEnv, { useService: true })) ||
        (await startKernelHost(startEnv, { useService: false }));
      if (!started && !kernelHostAvailable()) {
        if (!cancelled) {
          setError("内核不可用");
          setLoading(false);
        }
        return;
      }
      const next = new KernelSessionClient({
        transport: { sendLine: sendKernelLine, onLine: onKernelLine },
        requestTimeoutMs: 60_000,
      });
      clientRef.current = next;
      try {
        await pushProviderKeys(next);
      } catch {
        // 老内核没有 provider/setKeys：列表仍可看，key 状态会显示未设置。
      }
      if (!cancelled) await reload();
    })();
    return () => {
      cancelled = true;
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [reload]);

  const defaultProviderId = state.default?.providerId;
  const defaultModelId = state.default?.modelId;

  // 预设过滤：名称 / Base URL / 模板 id，大小写不敏感。
  const presetFilter = presetQuery.trim().toLowerCase();
  const visiblePresets = presetFilter
    ? state.presets.filter(
        (preset) =>
          preset.name.toLowerCase().includes(presetFilter) ||
          preset.baseUrl.toLowerCase().includes(presetFilter) ||
          preset.id.toLowerCase().includes(presetFilter),
      )
    : state.presets;

  const beginEdit = (provider?: ProviderSummary) => {
    setNote(null);
    setApiKey("");
    if (!provider) {
      setPresetQuery("");
      setEditing({ ...EMPTY_DRAFT });
      return;
    }
    setEditing({
      providerId: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      protocol: provider.protocol ?? "openai-chat-completions",
      models: provider.models.join(", "),
      template: provider.template,
      enabled: provider.enabled,
    });
  };

  const applyPreset = (preset: ProviderPreset) => {
    setEditing((current) => ({
      ...(current ?? EMPTY_DRAFT),
      name: preset.name,
      baseUrl: preset.baseUrl,
      protocol: preset.protocol,
      models: preset.models.join(", "),
      template: preset.id,
    }));
  };

  const save = async () => {
    if (!editing) return;
    const draft: ProviderDraft = {
      providerId: editing.providerId,
      name: editing.name.trim(),
      baseUrl: editing.baseUrl.trim(),
      protocol: editing.protocol,
      models: modelsOf(editing),
      template: editing.template,
      enabled: editing.enabled,
    };
    if (!draft.name) {
      setNote("请填 Provider 名称");
      return;
    }
    setBusy("save");
    setNote(null);
    try {
      const providerId = await saveProvider(client(), draft);
      if (apiKey.trim()) await setProviderKey(providerId, apiKey.trim());
      await pushProviderKeys(client());
      setEditing(null);
      setApiKey("");
      setNote("已保存");
      await reload();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const remove = (provider: ProviderSummary) => {
    Alert.alert("删除供应商", `删除「${provider.name}」？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          setBusy(`remove:${provider.id}`);
          void (async () => {
            try {
              await removeProvider(client(), provider.id);
              await removeProviderKey(provider.id);
              await pushProviderKeys(client());
              setNote("已删除");
              await reload();
            } catch (cause) {
              setNote(cause instanceof Error ? cause.message : String(cause));
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  };

  const usableSelection = (
    provider: ProviderSummary,
    modelId = provider.models[0],
  ): ModelSelection | null => {
    if (!modelId) return null;
    return {
      providerId: provider.id,
      modelId,
      ...(provider.defaultReasoning ? { reasoningLevel: provider.defaultReasoning } : {}),
    };
  };

  const test = (provider: ProviderSummary) => {
    const selection = usableSelection(provider);
    if (!selection) {
      setNote("这个 Provider 没有模型，先在编辑里填模型 ID");
      return;
    }
    setBusy(`test:${provider.id}`);
    setNote(null);
    void (async () => {
      const result = await testProvider(client(), selection);
      setNote(result.success ? `连通性通过：${provider.name}` : `连通性失败：${result.error}`);
      setBusy(null);
    })();
  };

  const makeDefault = (provider: ProviderSummary) => {
    const selection = usableSelection(provider);
    if (!selection) {
      setNote("这个 Provider 没有模型，不能设为默认");
      return;
    }
    setBusy(`default:${provider.id}`);
    void (async () => {
      try {
        await setDefaultProvider(client(), selection);
        setNote(`默认模型：${provider.name} / ${selection.modelId}（重启 App 后新会话生效）`);
        await reload();
      } catch (cause) {
        setNote(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    })();
  };

  // 单模型设默认：走与供应商级按钮同一条 setDefaultProvider 链路。
  const makeModelDefault = (provider: ProviderSummary, modelId: string) => {
    const selection = usableSelection(provider, modelId);
    if (!selection) return;
    setBusy(`default:${provider.id}:${modelId}`);
    void (async () => {
      try {
        await setDefaultProvider(client(), selection);
        setNote(`默认模型：${provider.name} / ${modelId}（重启 App 后新会话生效）`);
        await reload();
      } catch (cause) {
        setNote(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    })();
  };

  const saveModel = async (
    provider: ProviderSummary,
    modelId: string,
    config: ProviderModelConfig,
  ) => {
    const models = provider.models.includes(modelId)
      ? provider.models
      : [...provider.models, modelId];
    await saveProvider(client(), {
      providerId: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      protocol: provider.protocol ?? "openai-chat-completions",
      models,
      ...(provider.template ? { template: provider.template } : {}),
      enabled: provider.enabled,
      modelConfigs: { [modelId]: config },
    });
    await reload();
  };

  const body = (() => {
    if (editing) {
      return (
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <SectionCard>
            <View style={styles.formBody}>
              <Text style={[styles.formTitle, { color: t.ink }]}>
                {editing.providerId ? "编辑供应商" : "添加供应商"}
              </Text>
              {!editing.providerId && state.presets.length > 0 && (
                <>
                  <Text style={[styles.label, { color: t.inkSub }]}>从预设开始</Text>
                  {state.presets.length > 6 && (
                    <TextInput
                      value={presetQuery}
                      onChangeText={setPresetQuery}
                      placeholder="搜索预设：名称 / 地址 / 模板 ID"
                      placeholderTextColor={t.inkFaint}
                      autoCapitalize="none"
                      autoCorrect={false}
                      accessibilityLabel="搜索预设"
                      style={[
                        styles.input,
                        styles.presetSearch,
                        { color: t.ink, borderColor: t.hairline, backgroundColor: t.surfaceSoft },
                      ]}
                    />
                  )}
                  {visiblePresets.length === 0 ? (
                    <Text style={[styles.presetEmpty, { color: t.inkFaint }]}>没有匹配的预设</Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
                      {visiblePresets.map((preset) => {
                        const active = editing.template === preset.id;
                        return (
                          <PressableScale
                            key={preset.id}
                            onPress={() => applyPreset(preset)}
                            scaleTo={0.96}
                            accessibilityRole="button"
                            accessibilityLabel={`使用预设 ${preset.name}`}
                            style={[
                              styles.presetCard,
                              {
                                backgroundColor: active ? t.brandSoft : t.surfaceSoft,
                                borderColor: active ? t.brand : t.hairline,
                              },
                            ]}
                          >
                            <View style={styles.presetTitle}>
                              <ProviderLogo
                                logoKey={preset.logoKey}
                                id={preset.id}
                                name={preset.name}
                                size={20}
                              />
                              <Text
                                style={[styles.presetName, { color: active ? t.brand : t.ink }]}
                                numberOfLines={1}
                              >
                                {preset.name}
                              </Text>
                            </View>
                            <Text style={[styles.presetUrl, { color: t.inkFaint }]} numberOfLines={1}>
                              {preset.baseUrl.replace(/^https?:\/\//u, "")}
                            </Text>
                          </PressableScale>
                        );
                      })}
                    </ScrollView>
                  )}
                </>
              )}

              <Text style={[styles.label, { color: t.inkSub }]}>名称</Text>
              <TextInput
                value={editing.name}
                onChangeText={(name) => setEditing({ ...editing, name })}
                placeholder="我的模型服务"
                placeholderTextColor={t.inkFaint}
                style={[styles.input, { color: t.ink, borderColor: t.hairline, backgroundColor: t.surfaceSoft }]}
              />

              <Text style={[styles.label, { color: t.inkSub }]}>Base URL</Text>
              <TextInput
                value={editing.baseUrl}
                onChangeText={(baseUrl) => setEditing({ ...editing, baseUrl })}
                placeholder="https://api.example.com/v1"
                placeholderTextColor={t.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: t.ink, borderColor: t.hairline, backgroundColor: t.surfaceSoft }]}
              />

              <Text style={[styles.label, { color: t.inkSub }]}>协议</Text>
              <View style={styles.chips}>
                {PROVIDER_PROTOCOLS.map((protocol) => {
                  const active = editing.protocol === protocol.value;
                  return (
                    <PressableScale
                      key={protocol.value}
                      onPress={() => setEditing({ ...editing, protocol: protocol.value })}
                      scaleTo={0.95}
                      accessibilityRole="button"
                      accessibilityLabel={`协议 ${protocol.label}`}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? t.brandSoft : t.surfaceSoft,
                          borderColor: active ? t.brand : t.hairline,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? t.brand : t.ink }]}>
                        {protocol.label}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>

              <Text style={[styles.label, { color: t.inkSub }]}>模型 ID（逗号分隔）</Text>
              <TextInput
                value={editing.models}
                onChangeText={(models) => setEditing({ ...editing, models })}
                placeholder="gpt-5.4, glm-5"
                placeholderTextColor={t.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                style={[
                  styles.input,
                  styles.multiline,
                  { color: t.ink, borderColor: t.hairline, backgroundColor: t.surfaceSoft },
                ]}
              />

              <Text style={[styles.label, { color: t.inkSub }]}>
                API Key{editing.providerId && keys[editing.providerId] ? "（已保存，留空不改）" : ""}
              </Text>
              <TextInput
                value={apiKey}
                onChangeText={setApiKey}
                placeholder={editing.providerId && keys[editing.providerId] ? "••••••••" : "sk-…"}
                placeholderTextColor={t.inkFaint}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: t.ink, borderColor: t.hairline, backgroundColor: t.surfaceSoft }]}
              />
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                Key 存在 Android Keystore，不写进配置文件；只在内核内存里使用。
              </Text>

              <View style={styles.rowBetween}>
                <Text style={[styles.switchLabel, { color: t.inkSub }]}>启用</Text>
                <Switch
                  value={editing.enabled}
                  onValueChange={(enabled) => setEditing({ ...editing, enabled })}
                  trackColor={{ false: t.surfaceSoft, true: t.brandSoft }}
                  thumbColor={editing.enabled ? t.brand : t.inkGhost}
                  ios_backgroundColor={t.surfaceSoft}
                />
              </View>

              <View style={styles.actions}>
                <PillButton
                  label="取消"
                  variant="secondary"
                  onPress={() => {
                    setEditing(null);
                    setApiKey("");
                    setNote(null);
                  }}
                />
                <PillButton
                  label={busy === "save" ? "保存中…" : "保存"}
                  variant="primary"
                  onPress={() => void save()}
                  disabled={busy === "save"}
                />
              </View>
            </View>
          </SectionCard>
        </AppearIn>
      );
    }

    return (
      <>
        {state.providers.length === 0 && !loading && (
          <Text style={[styles.empty, { color: t.inkSub }]}>
            还没有 Provider。添加一个模型服务后，新会话就能选它。
          </Text>
        )}
        {state.providers.map((provider, providerIndex) => {
          const isDefault =
            provider.id === defaultProviderId &&
            (defaultModelId ? provider.models.includes(defaultModelId) : false);
          return (
            <AppearIn key={provider.id} delay={staggerDelay(providerIndex, 32, 240)}>
              <SectionCard>
                <View style={styles.providerHead}>
                  <ProviderLogo
                    logoKey={provider.logoKey}
                    id={provider.id}
                    name={provider.name}
                    size={38}
                  />
                  <View style={styles.titleColumn}>
                    <Text style={[styles.cardTitle, { color: t.ink }]}>{provider.name}</Text>
                    <Text style={[styles.sub, { color: t.inkSub }]} numberOfLines={1}>
                      {protocolLabel(provider.protocol)} · {provider.baseUrl || "未配置端点"}
                    </Text>
                  </View>
                  <View style={styles.badges}>
                    {isDefault && <StatusPill bg={t.brandSoft} color={t.brand} label="默认" />}
                    <StatusPill
                      bg={provider.hasKey ? t.okSoft : t.amberSoft}
                      color={provider.hasKey ? t.ok : t.amber}
                      label={provider.hasKey ? "Key 已保存" : "缺 Key"}
                    />
                    {provider.account && <StatusPill bg={t.steelSoft} color={t.steel} label="账号" />}
                  </View>
                </View>

                <Divider />

                <View style={styles.modelList}>
                  {provider.models.length === 0 ? (
                    <Text style={[styles.emptyModels, { color: t.inkSub }]}>没有模型</Text>
                  ) : (
                    provider.models.map((modelId, modelIndex) => {
                      const config = provider.modelInfo?.find((model) => model.id === modelId)?.config;
                      const input = config?.properties?.inputFormat;
                      const window = config?.properties?.contextWindow;
                      const isDefaultModel =
                        provider.id === defaultProviderId && modelId === defaultModelId;
                      return (
                        <View
                          key={modelId}
                          style={
                            modelIndex > 0
                              ? [styles.modelRow, styles.modelRowBordered, { borderTopColor: t.hairline }]
                              : styles.modelRow
                          }
                        >
                          <MonogramAvatar id={modelId} name={modelId} size={20} />
                          <View style={styles.modelInfo}>
                            <Text style={[styles.modelName, { color: t.ink }]} numberOfLines={1}>
                              {modelId}
                            </Text>
                            <View style={styles.modelBadges}>
                              {window ? (
                                <Text style={[styles.modelMeta, { color: t.inkFaint }]}>
                                  {window >= 1_000_000
                                    ? `${Math.round(window / 100_000) / 10}M`
                                    : window >= 1000
                                      ? `${Math.round(window / 1000)}K`
                                      : window}
                                </Text>
                              ) : null}
                              {input?.supportsImage ? (
                                <StatusPill bg={t.steelSoft} color={t.steel} label="视觉" />
                              ) : null}
                              {input?.supportsPdf ? (
                                <StatusPill bg={t.surfaceSoft} color={t.inkSub} label="PDF" />
                              ) : null}
                            </View>
                          </View>
                          {isDefaultModel ? (
                            // 模型行的「默认」是状态徽标不是按钮，保持小尺寸 chip 而不是 PillButton。
                            <View
                              style={[
                                styles.modelDefault,
                                { borderColor: t.brand, backgroundColor: t.brandSoft },
                              ]}
                            >
                              <Icon name="check" size={9} color={t.brand} strokeWidth={2.6} />
                              <Text style={[styles.modelDefaultText, { color: t.brand }]}>默认</Text>
                            </View>
                          ) : (
                            <PressableScale
                              onPress={() => makeModelDefault(provider, modelId)}
                              disabled={busy !== null}
                              hitSlop={6}
                              accessibilityRole="button"
                              accessibilityLabel={`将 ${modelId} 设为默认模型`}
                              style={[
                                styles.modelDefault,
                                { borderColor: t.hairline, backgroundColor: t.surfaceSoft },
                              ]}
                            >
                              <Text style={[styles.modelDefaultTextIdle, { color: t.inkSub }]}>
                                {busy === `default:${provider.id}:${modelId}` ? "设置中…" : "设为默认"}
                              </Text>
                            </PressableScale>
                          )}
                          {provider.personal ? (
                            <PressableScale
                              onPress={() =>
                                setModelEditor({ provider, modelId, ...(config ? { config } : {}) })
                              }
                              hitSlop={6}
                              accessibilityRole="button"
                              accessibilityLabel={`编辑模型 ${modelId}`}
                              style={[styles.modelEdit, { backgroundColor: t.surfaceSoft }]}
                            >
                              <Icon name="pen" size={12} color={t.inkSub} />
                            </PressableScale>
                          ) : null}
                        </View>
                      );
                    })
                  )}
                  {provider.personal ? (
                    <PressableScale
                      onPress={() => setModelEditor({ provider })}
                      accessibilityRole="button"
                      accessibilityLabel="添加模型"
                      style={[styles.addModel, { borderColor: t.hairlineStrong }]}
                    >
                      <Icon name="plus" size={11} color={t.brand} />
                      <Text style={[styles.addModelText, { color: t.brand }]}>添加模型</Text>
                    </PressableScale>
                  ) : null}
                </View>

                <Divider />

                <View style={styles.actions}>
                  <PillButton
                    label={busy === `test:${provider.id}` ? "测试中…" : "测试"}
                    variant="secondary"
                    onPress={() => test(provider)}
                    disabled={busy !== null}
                  />
                  <PillButton
                    label={busy === `default:${provider.id}` ? "设置中…" : "设为默认"}
                    variant="secondary"
                    onPress={() => makeDefault(provider)}
                    disabled={busy !== null}
                  />
                  {provider.personal && (
                    <>
                      <PillButton
                        label="编辑"
                        variant="secondary"
                        onPress={() => beginEdit(provider)}
                        disabled={busy !== null}
                      />
                      <PillButton
                        label="删除"
                        variant="danger"
                        onPress={() => remove(provider)}
                        disabled={busy !== null}
                      />
                    </>
                  )}
                </View>
              </SectionCard>
            </AppearIn>
          );
        })}

        <AppearIn delay={staggerDelay(state.providers.length, 32, 240)}>
          <PillButton
            label="添加供应商"
            variant="primary"
            icon="plus"
            buttonSize="lg"
            onPress={() => beginEdit()}
          />
        </AppearIn>
      </>
    );
  })();

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[t.glowTop, t.bgGradient[0], t.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="模型设置" subtitle="供应商 · 模型 · 思考档位" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(8) }]}
      >
        <Text style={[styles.section, { color: t.inkSub }]}>供应商</Text>
        {loading && <ActivityIndicator style={styles.loading} />}
        {error && <Text style={[styles.noteText, { color: t.red }]}>{error}</Text>}
        {note && (
          <Text
            style={[
              styles.noteText,
              { color: note.includes("失败") || note.includes("请填") ? t.red : t.ok },
            ]}
          >
            {note}
          </Text>
        )}
        {body}
      </ScrollView>

      <ModelConfigSheet
        visible={modelEditor !== null}
        provider={modelEditor?.provider ?? null}
        modelId={modelEditor?.modelId}
        initialConfig={modelEditor?.config}
        onResolve={(providerId, modelId) => resolveProviderModel(client(), providerId, modelId)}
        onClose={() => setModelEditor(null)}
        onSave={(modelId, config) => {
          if (!modelEditor) return Promise.resolve();
          return saveModel(modelEditor.provider, modelId, config);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(3) },
  section: {
    ...text("micro"),
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  loading: { marginVertical: space(6) },
  noteText: { ...text("small") },
  empty: { ...text("body") },
  // —— 编辑表单 ——
  formBody: { padding: space(3.5), gap: space(2) },
  formTitle: { ...text("heading"), fontWeight: "700" },
  label: { ...text("micro"), marginTop: space(1) },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    ...text("body"),
  },
  presetSearch: { ...text("small") },
  presetEmpty: { ...text("micro"), paddingVertical: space(1) },
  presetRow: { gap: space(2), paddingVertical: space(0.5) },
  presetTitle: { flexDirection: "row", alignItems: "center", gap: space(1.25) },
  presetName: { ...text("micro"), fontWeight: "700" },
  presetUrl: { ...text("micro") },
  presetCard: {
    width: 148,
    minHeight: size.row,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
    gap: space(0.75),
    justifyContent: "center",
  },
  hint: { ...text("micro") },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchLabel: { ...text("small") },
  actions: {
    flexDirection: "row",
    gap: space(2),
    flexWrap: "wrap",
  },
  // —— 协议 chip ——
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
  },
  chipText: { ...text("small") },
  multiline: { minHeight: space(15), textAlignVertical: "top" },
  // —— 供应商卡 ——
  providerHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
  },
  titleColumn: { flex: 1, paddingRight: space(2) },
  cardTitle: { ...text("heading"), fontWeight: "600" },
  sub: { ...text("small"), marginTop: space(0.5) },
  badges: { flexDirection: "row", gap: space(1), flexWrap: "wrap", justifyContent: "flex-end" },
  pill: { borderRadius: radius.chip, paddingHorizontal: space(2), paddingVertical: space(0.5) },
  pillText: { ...text("micro"), fontWeight: "600" },
  modelList: {
    gap: space(1.5),
    paddingHorizontal: space(3.5),
    paddingVertical: space(2),
  },
  emptyModels: { ...text("small") },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingVertical: space(1),
  },
  // 行间发丝线：宽度走静态样式，颜色用主题 token 在渲染处覆盖（styles 是模块级静态）。
  modelRowBordered: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(1.5),
  },
  modelInfo: { flex: 1, gap: space(0.5) },
  modelName: { ...text("small"), fontWeight: "600" },
  modelBadges: { flexDirection: "row", alignItems: "center", gap: space(1.25) },
  modelMeta: { ...text("micro") },
  modelEdit: {
    width: size.chip,
    height: size.chip,
    borderRadius: radius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  modelDefault: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(0.75),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: space(1),
  },
  modelDefaultText: { ...text("micro"), fontWeight: "700" },
  modelDefaultTextIdle: { ...text("micro") },
  addModel: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    marginTop: space(1),
  },
  addModelText: { ...text("micro"), fontWeight: "700" },
});
