// 设置页：模型 Provider 的配置（D25 可用性收口）。
//
// 配置写内核的 `provider_config.json`（与桌面/CLI 同一份）；API key 存 Android Keystore
// （expo-secure-store），保存后经 `provider/setKeys` 只送进内核内存，不落配置文件。
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../../components/Icon";

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
import { radius, space, type as typeScale, useNibiTheme } from "../../theme";

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
      const env = { ...(kernelStartEnv() ?? {}), ...(await providerKeysEnv()) };
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

  const beginEdit = (provider?: ProviderSummary) => {
    setNote(null);
    setApiKey("");
    if (!provider) {
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

  const usableSelection = (provider: ProviderSummary): ModelSelection | null => {
    const modelId = provider.models[0];
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
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <Text style={[styles.cardTitle, { color: t.ink }]}>
            {editing.providerId ? "编辑供应商" : "添加供应商"}
          </Text>
          {!editing.providerId && state.presets.length > 0 && (
            <>
              <Text style={[styles.label, { color: t.inkSub }]}>从预设开始</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
                {state.presets.map((preset) => {
                  const active = editing.template === preset.id;
                  return (
                    <Pressable
                      key={preset.id}
                      onPress={() => applyPreset(preset)}
                      style={[
                        styles.presetCard,
                        {
                          backgroundColor: active ? t.brandSoft : t.panel,
                          borderColor: active ? t.brand : t.hairline,
                        },
                      ]}
                    >
                      <Text style={{ color: active ? t.brand : t.ink, fontSize: 11, fontWeight: "700" }} numberOfLines={1}>
                        {preset.name}
                      </Text>
                      <Text style={{ color: t.inkFaint, fontSize: 8.5 }} numberOfLines={1}>
                        {preset.baseUrl.replace(/^https?:\/\//u, "")}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          <Text style={[styles.label, { color: t.inkSub }]}>名称</Text>
          <TextInput
            value={editing.name}
            onChangeText={(name) => setEditing({ ...editing, name })}
            placeholder="我的模型服务"
            placeholderTextColor={t.inkFaint}
            style={[styles.input, { color: t.ink, borderColor: t.hairline, backgroundColor: t.panel }]}
          />

          <Text style={[styles.label, { color: t.inkSub }]}>Base URL</Text>
          <TextInput
            value={editing.baseUrl}
            onChangeText={(baseUrl) => setEditing({ ...editing, baseUrl })}
            placeholder="https://api.example.com/v1"
            placeholderTextColor={t.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: t.ink, borderColor: t.hairline, backgroundColor: t.panel }]}
          />

          <Text style={[styles.label, { color: t.inkSub }]}>协议</Text>
          <View style={styles.chips}>
            {PROVIDER_PROTOCOLS.map((protocol) => (
              <Pressable
                key={protocol.value}
                onPress={() => setEditing({ ...editing, protocol: protocol.value })}
                style={[
                  styles.chip,
                  {
                    backgroundColor:
                      editing.protocol === protocol.value ? t.brandSoft : t.panel,
                    borderColor:
                      editing.protocol === protocol.value ? t.brand : t.hairline,
                  },
                ]}
              >
                <Text style={{ color: t.ink, fontSize: typeScale.small }}>{protocol.label}</Text>
              </Pressable>
            ))}
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
              { color: t.ink, borderColor: t.hairline, backgroundColor: t.panel },
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
            style={[styles.input, { color: t.ink, borderColor: t.hairline, backgroundColor: t.panel }]}
          />
          <Text style={[styles.hint, { color: t.inkFaint }]}>
            Key 存在 Android Keystore，不写进配置文件；只在内核内存里使用。
          </Text>

          <View style={styles.rowBetween}>
            <Text style={{ color: t.inkSub, fontSize: typeScale.small }}>启用</Text>
            <Switch
              value={editing.enabled}
              onValueChange={(enabled) => setEditing({ ...editing, enabled })}
            />
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                setEditing(null);
                setApiKey("");
                setNote(null);
              }}
              style={[styles.button, { borderColor: t.hairline, backgroundColor: t.panel }]}
            >
              <Text style={{ color: t.inkSub }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => void save()}
              disabled={busy === "save"}
              style={[styles.button, { borderColor: t.brand, backgroundColor: t.brand }]}
            >
              <Text style={{ color: t.brandFg, fontWeight: "600" }}>
                {busy === "save" ? "保存中…" : "保存"}
              </Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return (
      <>
        {state.providers.length === 0 && !loading && (
          <Text style={[styles.empty, { color: t.inkSub }]}>
            还没有 Provider。添加一个模型服务后，新会话就能选它。
          </Text>
        )}
        {state.providers.map((provider) => {
          const isDefault =
            provider.id === defaultProviderId &&
            (defaultModelId ? provider.models.includes(defaultModelId) : false);
          return (
            <View
              key={provider.id}
              style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}
            >
              <View style={styles.rowBetween}>
                <View style={[styles.providerAvatar, { backgroundColor: provider.hasKey ? t.brandSoft : t.panel }]}>
                  <Text style={[styles.providerAvatarText, { color: provider.hasKey ? t.brand : t.inkFaint }]}>
                    {provider.name.trim().slice(0, 1).toUpperCase() || "N"}
                  </Text>
                </View>
                <View style={styles.titleColumn}>
                  <Text style={[styles.cardTitle, { color: t.ink }]}>{provider.name}</Text>
                  <Text style={[styles.sub, { color: t.inkSub }]} numberOfLines={1}>
                    {protocolLabel(provider.protocol)} · {provider.baseUrl || "未配置端点"}
                  </Text>
                </View>
                <View style={styles.badges}>
                  {isDefault && (
                    <View style={[styles.badge, { backgroundColor: t.brandSoft }]}>
                      <Text style={{ color: t.brand, fontSize: typeScale.micro }}>默认</Text>
                    </View>
                  )}
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: provider.hasKey ? t.okSoft : t.amberSoft },
                    ]}
                  >
                    <Text
                      style={{
                        color: provider.hasKey ? t.ok : t.amber,
                        fontSize: typeScale.micro,
                      }}
                    >
                      {provider.hasKey ? "Key 已保存" : "缺 Key"}
                    </Text>
                  </View>
                  {provider.account && (
                    <View style={[styles.badge, { backgroundColor: t.steelSoft }]}>
                      <Text style={{ color: t.steel, fontSize: typeScale.micro }}>账号</Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.modelList}>
                {provider.models.length === 0 ? (
                  <Text style={[styles.sub, { color: t.inkSub }]}>没有模型</Text>
                ) : (
                  provider.models.map((modelId) => {
                    const config = provider.modelInfo?.find((model) => model.id === modelId)?.config;
                    const input = config?.properties?.inputFormat;
                    const window = config?.properties?.contextWindow;
                    return (
                      <View
                        key={modelId}
                        style={[styles.modelRow, { borderColor: t.hairline }]}
                      >
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
                              <View style={[styles.badge, { backgroundColor: t.steelSoft }]}>
                                <Text style={{ color: t.steel, fontSize: typeScale.micro }}>视觉</Text>
                              </View>
                            ) : null}
                            {input?.supportsPdf ? (
                              <View style={[styles.badge, { backgroundColor: t.panel }]}>
                                <Text style={{ color: t.inkSub, fontSize: typeScale.micro }}>PDF</Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                        {provider.personal ? (
                          <Pressable
                            onPress={() =>
                              setModelEditor({ provider, modelId, ...(config ? { config } : {}) })
                            }
                            hitSlop={6}
                            accessibilityRole="button"
                            accessibilityLabel={`编辑模型 ${modelId}`}
                            style={[styles.modelEdit, { backgroundColor: t.panel }]}
                          >
                            <Icon name="pen" size={12} color={t.inkSub} />
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })
                )}
                {provider.personal ? (
                  <Pressable
                    onPress={() => setModelEditor({ provider })}
                    style={[styles.addModel, { borderColor: t.hairline }]}
                  >
                    <Icon name="plus" size={11} color={t.brand} />
                    <Text style={[styles.addModelText, { color: t.brand }]}>添加模型</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => test(provider)}
                  disabled={busy !== null}
                  style={[styles.smallButton, { borderColor: t.hairline, backgroundColor: t.panel }]}
                >
                  <Text style={{ color: t.inkSub, fontSize: typeScale.small }}>
                    {busy === `test:${provider.id}` ? "测试中…" : "测试"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => makeDefault(provider)}
                  disabled={busy !== null}
                  style={[styles.smallButton, { borderColor: t.hairline, backgroundColor: t.panel }]}
                >
                  <Text style={{ color: t.inkSub, fontSize: typeScale.small }}>
                    {busy === `default:${provider.id}` ? "设置中…" : "设为默认"}
                  </Text>
                </Pressable>
                {provider.personal && (
                  <>
                    <Pressable
                      onPress={() => beginEdit(provider)}
                      disabled={busy !== null}
                      style={[styles.smallButton, { borderColor: t.hairline, backgroundColor: t.panel }]}
                    >
                      <Text style={{ color: t.inkSub, fontSize: typeScale.small }}>编辑</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => remove(provider)}
                      disabled={busy !== null}
                      style={[styles.smallButton, { borderColor: t.redSoft, backgroundColor: t.panel }]}
                    >
                      <Text style={{ color: t.red, fontSize: typeScale.small }}>删除</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          );
        })}

        <Pressable
          onPress={() => beginEdit()}
          style={[styles.addButton, { borderColor: t.brand, backgroundColor: t.brandSoft }]}
        >
          <Icon name="plus" size={15} color={t.brand} />
          <Text style={{ color: t.brand, fontWeight: "700", fontSize: 12.5 }}>添加供应商</Text>
        </Pressable>
      </>
    );
  })();

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + space(2), borderBottomColor: t.hairline }]}>
        <Pressable
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: t.panel, borderColor: t.hairline }]}
          accessibilityRole="button"
          accessibilityLabel="返回"
        >
          <Icon name="chevron-left" size={16} color={t.inkSub} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.screenTitle, { color: t.ink }]}>模型设置</Text>
          <Text style={[styles.headerSub, { color: t.inkFaint }]}>供应商 · 模型 · 思考档位</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(8) }]}
      >
        <Text style={[styles.section, { color: t.inkSub }]}>供应商</Text>
        {loading && <ActivityIndicator style={styles.loading} />}
        {error && <Text style={{ color: t.red, marginBottom: space(3) }}>{error}</Text>}
        {note && (
          <Text
            style={{
              color: note.includes("失败") || note.includes("请填") ? t.red : t.ok,
              marginBottom: space(3),
            }}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(4),
    paddingBottom: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1, alignItems: "center", gap: 1 },
  headerSpacer: { width: 40, height: 40 },
  headerSub: { fontSize: 9.5 },
  providerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  providerAvatarText: { fontSize: 16, fontWeight: "700" },
  presetRow: { gap: space(2), paddingVertical: 2 },
  presetCard: {
    width: 148,
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
    gap: 3,
    justifyContent: "center",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: { fontSize: typeScale.title, fontWeight: "700" },
  content: { paddingHorizontal: space(4), paddingTop: space(3) },
  section: {
    fontSize: typeScale.micro,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: space(3),
  },
  loading: { marginVertical: space(6) },
  empty: { fontSize: typeScale.body, lineHeight: 21, marginBottom: space(4) },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(4),
    marginBottom: space(3),
  },
  cardTitle: { fontSize: typeScale.heading, fontWeight: "600" },
  sub: { fontSize: typeScale.small, marginTop: space(1) },
  modelList: { gap: space(1.5), marginTop: space(1) },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(1.5),
  },
  modelInfo: { flex: 1, gap: 2 },
  modelName: { fontSize: 11.5, fontWeight: "600" },
  modelBadges: { flexDirection: "row", alignItems: "center", gap: 5 },
  modelMeta: { fontSize: 9.5 },
  modelEdit: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  addModel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    marginTop: space(1),
  },
  addModelText: { fontSize: 10.5, fontWeight: "700" },
  titleColumn: { flex: 1, paddingRight: space(2) },
  badges: { flexDirection: "row", gap: space(1), flexWrap: "wrap", justifyContent: "flex-end" },
  badge: { borderRadius: radius.chip, paddingHorizontal: space(2), paddingVertical: space(0.5) },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space(2),
  },
  label: { fontSize: typeScale.micro, marginTop: space(3), marginBottom: space(1) },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    fontSize: typeScale.body,
  },
  multiline: { minHeight: 60, textAlignVertical: "top" },
  hint: { fontSize: typeScale.micro, marginTop: space(1.5), lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
  },
  actions: { flexDirection: "row", gap: space(2), marginTop: space(3), flexWrap: "wrap" },
  button: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
    alignItems: "center",
  },
  smallButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingVertical: space(3),
    marginTop: space(1),
  },
});