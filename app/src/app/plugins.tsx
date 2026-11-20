// 插件中心：内置样例插件的启停、状态、降级原因与面板入口。
//
// 只显示 manifest 与解析结果；插件代码不会在 UI 进程执行（MCP 工具在 `:kernel` 的
// 子进程里跑）。这里也是“为什么不能渲染”的唯一解释入口：不兼容、清单有误、已降级。
// 2.0：ScreenHeader（右槽=市场入口）；插件卡改 SectionCard + Row 头部；
// 面板/网页岛入口统一 MenuRow（doc/globe 图标）；状态徽标统一 soft 底 + 对应色。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../components/Icon";
import { MenuRow } from "../components/ui/MenuRow";
import { Row } from "../components/ui/Row";
import { Divider, SectionCard } from "../components/ui/SectionCard";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { usePlugins } from "../plugins/usePlugins";
import type { LoadedPlugin } from "../plugins/store";
import { AppearIn, staggerDelay } from "../motion/appear";
import { PressableScale } from "../motion/PressableScale";
import { radius, space, text, useNibiTheme } from "../theme";

function statusOf(plugin: LoadedPlugin): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (plugin.parsed.status === "invalid") return { label: "清单有误", tone: "danger" };
  if (plugin.parsed.status === "incompatible") return { label: "不兼容", tone: "warn" };
  if (plugin.licenseBlocked) return { label: "需会员", tone: "warn" };
  if (!plugin.parsed.slotsAvailable) return { label: "已降级", tone: "warn" };
  if (!plugin.enabled) return { label: "已停用", tone: "muted" };
  return { label: "可用", tone: "ok" };
}

function PluginCard({
  plugin,
  onToggle,
  onSetting,
}: {
  plugin: LoadedPlugin;
  onToggle: (enabled: boolean) => void;
  onSetting: (key: string, value: string | boolean) => void;
}) {
  const t = useNibiTheme();
  const manifest = plugin.parsed.manifest;
  // 开关用本地状态先行，避免父级异步 reload 把 Switch 拉回旧值造成闪烁。
  const [enabled, setEnabled] = useState(plugin.enabled);
  useEffect(() => {
    setEnabled(plugin.enabled);
  }, [plugin.enabled]);
  const status = statusOf(plugin);
  const tone =
    status.tone === "ok" ? t.ok : status.tone === "warn" ? t.amber : status.tone === "danger" ? t.red : t.inkFaint;
  const toneSoft =
    status.tone === "ok" ? t.okSoft : status.tone === "warn" ? t.amberSoft : status.tone === "danger" ? t.redSoft : t.surfaceSoft;
  const panels = manifest.contributes.panels;
  const webIslands = manifest.contributes.webIslands;
  const canEnable = plugin.parsed.status === "ready" && plugin.parsed.slotsAvailable;

  // 设置与命令面：设置值本地先行（文本失焦时保存），命令只读展示（在对话里用 /名字 触发）。
  const [values, setValues] = useState(plugin.settings);
  useEffect(() => {
    setValues(plugin.settings);
  }, [plugin.settings]);
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [showDetails, setShowDetails] = useState(false);
  const settings = manifest.settings ?? [];
  const commands: Array<{ key: string; title: string; name: string }> = [];
  const commandNames = new Set<string>();
  const addCommand = (key: string, title: string, name: string) => {
    if (!name || commandNames.has(name)) return;
    commandNames.add(name);
    commands.push({ key, title: title.trim() || name, name });
  };
  for (const action of manifest.contributes.composerActions) {
    if (action.token?.kind === "command") addCommand(`a:${action.id}`, action.title, action.token.value);
  }
  for (const action of manifest.contributes.composerTools) {
    if (action.token?.kind === "command") addCommand(`t:${action.id}`, action.title, action.token.value);
  }
  for (const action of manifest.contributes.messageActions) {
    if (action.command) addCommand(`m:${action.id}`, action.title, action.command);
  }
  const skills = manifest.skills ?? [];
  const hasDetails = settings.length > 0 || commands.length > 0 || skills.length > 0;

  const commit = (key: string, value: string | boolean) => {
    setValues((current) => ({ ...current, [key]: value }));
    onSetting(key, value);
  };

  return (
    <SectionCard>
      <Row
        title={manifest.name}
        detail={`${manifest.id} · v${manifest.version}`}
        right={
          <View style={styles.headRight}>
            <View style={[styles.status, { backgroundColor: toneSoft }]}>
              <Text style={[styles.statusText, { color: tone }]}>{status.label}</Text>
            </View>
            <Switch
              value={enabled}
              disabled={!canEnable}
              onValueChange={(value) => {
                setEnabled(value);
                onToggle(value);
              }}
              trackColor={{ true: t.brand, false: t.hairline }}
              thumbColor={enabled ? t.brandFg : undefined}
              accessibilityLabel={`启用 ${manifest.name}`}
            />
          </View>
        }
      />

      <View style={styles.cardBody}>
        {manifest.description ? (
          <Text style={[styles.description, { color: t.inkSub }]}>{manifest.description}</Text>
        ) : null}

        {plugin.parsed.degraded.length > 0 ? (
          <View style={styles.chips}>
            <View style={[styles.chip, { backgroundColor: t.amberSoft }]}>
              <Text style={[styles.chipText, { color: t.amber }]}>已降级</Text>
            </View>
          </View>
        ) : null}

        {plugin.parsed.reason ? (
          <Text style={[styles.reason, { color: tone }]}>{plugin.parsed.reason}</Text>
        ) : null}

        {plugin.parsed.issues.length > 0 ? (
          <View style={styles.issues}>
            <Text style={[styles.issueTitle, { color: t.amber }]}>
              {plugin.parsed.issues.length} 项有误（可用部分仍生效）
            </Text>
            {plugin.parsed.issues.slice(0, 3).map((issue, index) => (
              <Text key={index} style={[styles.issue, { color: t.inkFaint }]} numberOfLines={2}>
                {issue.path || "/"} · {issue.message}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      {panels.length > 0 ? (
        <>
          <Divider />
          <View style={styles.entryGroup}>
            <Text style={[styles.entryLabel, { color: t.inkFaint }]}>面板</Text>
            {panels.map((panel) => {
              const degraded = plugin.parsed.degraded.includes(`panels:${panel.id}`);
              return (
                <MenuRow
                  key={panel.id}
                  icon="doc"
                  tone="steel"
                  label={panel.title}
                  detail={panel.description}
                  disabled={!canEnable}
                  onPress={() =>
                    router.push({
                      pathname: "/panel",
                      params: { pluginId: manifest.id, panelId: panel.id },
                    })
                  }
                  right={
                    degraded ? (
                      // 降级标记与 chevron 并排，别让状态顶掉入口箭头。
                      <View style={styles.entryRight}>
                        <Text style={[styles.panelDegraded, { color: t.amber }]}>已降级</Text>
                        <Icon name="chevron-right" size={13} color={t.inkGhost} />
                      </View>
                    ) : undefined
                  }
                />
              );
            })}
          </View>
        </>
      ) : null}

      {webIslands.length > 0 ? (
        <>
          <Divider />
          <View style={styles.entryGroup}>
            <Text style={[styles.entryLabel, { color: t.inkFaint }]}>网页</Text>
            {webIslands.map((island) => (
              <MenuRow
                key={island.id}
                icon="globe"
                tone="steel"
                label={island.title}
                detail="Web Island · 路由守卫 + 超时降级"
                disabled={!canEnable}
                onPress={() =>
                  router.push({
                    pathname: "/island",
                    params: { pluginId: manifest.id, islandId: island.id },
                  })
                }
              />
            ))}
          </View>
        </>
      ) : null}

      {hasDetails ? (
        <>
          <Divider />
          <View style={styles.details}>
            <PressableScale
              onPress={() => setShowDetails((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={`${showDetails ? "收起" : "展开"} ${manifest.name} 的设置与命令`}
              style={styles.detailsHead}
            >
              <Text style={[styles.detailsTitle, { color: t.inkSub }]}>
                设置与命令
                {settings.length > 0 ? ` · ${settings.length} 项设置` : ""}
                {commands.length > 0 ? ` · ${commands.length} 个命令` : ""}
              </Text>
              <View style={showDetails ? styles.chevronOpen : undefined}>
                <Icon name="chevron-down" size={13} color={t.inkFaint} />
              </View>
            </PressableScale>
            {showDetails ? (
              <View style={styles.detailsBody}>
                {settings.map((setting) => (
                  <View key={setting.id} style={styles.settingRow}>
                    <View style={styles.settingText}>
                      <Text style={[styles.settingTitle, { color: t.ink }]}>{setting.title}</Text>
                      {setting.description ? (
                        <Text style={[styles.settingDesc, { color: t.inkFaint }]}>
                          {setting.description}
                        </Text>
                      ) : null}
                    </View>
                    {setting.type === "toggle" ? (
                      <Switch
                        value={values[setting.id] === true}
                        onValueChange={(value) => commit(setting.id, value)}
                        trackColor={{ true: t.brand, false: t.hairline }}
                        thumbColor={values[setting.id] === true ? t.brandFg : undefined}
                        accessibilityLabel={setting.title}
                      />
                    ) : setting.type === "select" ? (
                      <View style={styles.selectRow}>
                        {setting.options.map((option) => {
                          const active = values[setting.id] === option.value;
                          return (
                            <PressableScale
                              key={option.value}
                              onPress={() => commit(setting.id, option.value)}
                              scaleTo={0.95}
                              style={[
                                styles.selectChip,
                                {
                                  backgroundColor: active ? t.brandSoft : t.surfaceSoft,
                                  borderColor: active ? t.brand : t.hairline,
                                },
                              ]}
                            >
                              <Text style={[styles.selectChipText, { color: active ? t.brand : t.inkSub }]}>
                                {option.label}
                              </Text>
                            </PressableScale>
                          );
                        })}
                      </View>
                    ) : null}
                    {setting.type === "text" ? (
                      <TextInput
                        value={textDrafts[setting.id] ?? String(values[setting.id] ?? "")}
                        onChangeText={(text) =>
                          setTextDrafts((current) => ({ ...current, [setting.id]: text }))
                        }
                        onBlur={() => {
                          const draft = textDrafts[setting.id];
                          if (draft !== undefined && draft !== values[setting.id]) {
                            commit(setting.id, draft);
                          }
                          setTextDrafts((current) => {
                            const next = { ...current };
                            delete next[setting.id];
                            return next;
                          });
                        }}
                        placeholder={setting.placeholder}
                        placeholderTextColor={t.inkFaint}
                        maxLength={setting.maxLength}
                        autoCapitalize="none"
                        autoCorrect={false}
                        accessibilityLabel={setting.title}
                        style={[
                          styles.settingInput,
                          { color: t.ink, borderColor: t.hairline, backgroundColor: t.surfaceSoft },
                        ]}
                      />
                    ) : null}
                  </View>
                ))}

                {commands.length > 0 ? (
                  <View style={styles.commands}>
                    <Text style={[styles.detailsLabel, { color: t.inkFaint }]}>命令</Text>
                    {commands.map((command) => (
                      <View key={command.key} style={styles.commandRow}>
                        <Text style={[styles.commandTitle, { color: t.inkSub }]} numberOfLines={1}>
                          {command.title}
                        </Text>
                        <Text style={[styles.commandName, { color: t.inkFaint }]} numberOfLines={1}>
                          /{command.name}
                        </Text>
                      </View>
                    ))}
                    <Text style={[styles.detailsHint, { color: t.inkGhost }]}>
                      在对话里输入 /命令名 或从加号菜单触发。
                    </Text>
                  </View>
                ) : null}

                {skills.length > 0 ? (
                  <View style={styles.commands}>
                    <Text style={[styles.detailsLabel, { color: t.inkFaint }]}>技能</Text>
                    {skills.map((skill) => (
                      <View key={skill.id} style={styles.commandRow}>
                        <Text style={[styles.commandTitle, { color: t.inkSub }]} numberOfLines={1}>
                          {skill.name ?? skill.id}
                        </Text>
                        <Text style={[styles.commandName, { color: t.inkFaint }]} numberOfLines={1}>
                          {skill.id}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </SectionCard>
  );
}

export default function PluginsScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const plugins = usePlugins();
  // 从首页带着输入框焦点进来时，键盘会弹一下又收回去；进入插件中心先明确收起。
  useFocusEffect(
    useCallback(() => {
      Keyboard.dismiss();
    }, []),
  );

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[t.glowTop, t.bgGradient[0], t.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader
        title="插件"
        subtitle="声明式槽 · 插件代码跑在子进程"
        onBack={() => router.back()}
        right={
          <PressableScale
            onPress={() => router.push("/market")}
            accessibilityRole="button"
            accessibilityLabel="打开插件市场"
            style={[styles.marketButton, { backgroundColor: t.brandSoft }]}
          >
            <Text style={[styles.marketText, { color: t.brand }]}>市场</Text>
          </PressableScale>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(6) }]}
        showsVerticalScrollIndicator={false}
      >
        {plugins.loading && plugins.plugins.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={t.brand} />
            <Text style={[styles.loadingText, { color: t.inkFaint }]}>读取插件清单…</Text>
          </View>
        ) : null}

        {plugins.error ? (
          <Text style={[styles.error, { color: t.red }]}>{plugins.error}</Text>
        ) : null}

        {plugins.plugins.map((plugin, index) => (
          <AppearIn key={plugin.dir} delay={staggerDelay(index, 32, 240)}>
            <PluginCard
              plugin={plugin}
              onSetting={(key, value) => {
                const id = plugin.parsed.manifest.id;
                void plugins.setSetting(id, key, value).catch((error: unknown) => {
                  plugins.reload().catch(() => undefined);
                  console.warn("[nibigo] 插件设置保存失败", error);
                });
              }}
              onToggle={(enabled) => {
                const id = plugin.parsed.manifest.id;
                void plugins.setEnabled(id, enabled).catch((error: unknown) => {
                  plugins.reload().catch(() => undefined);
                  console.warn("[nibigo] 插件启停失败", error);
                });
              }}
            />
          </AppearIn>
        ))}

        <AppearIn delay={staggerDelay(plugins.plugins.length, 32, 240)}>
          <View style={[styles.note, { borderColor: t.hairline }]}>
            <Text style={[styles.noteText, { color: t.inkFaint }]}>
              插件只能渲染受限 JSON 视图（文字/行/列/卡/徽标/进度/列表/按钮），不能改导航、主题或
              权限。工具卡的数据来自插件的 MCP 工具；插件子进程拿不到 Provider key。
            </Text>
            <Text style={[styles.noteText, { color: t.inkFaint }]}>
              远端桌面会话没有插件槽：同一份清单会如实降级为不渲染。
            </Text>
          </View>
        </AppearIn>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  marketButton: {
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1),
  },
  marketText: { ...text("small"), fontWeight: "700" },
  content: { paddingHorizontal: space(4), gap: space(3), paddingTop: space(2) },
  loading: { alignItems: "center", gap: space(2), paddingVertical: space(10) },
  loadingText: { ...text("small") },
  error: { ...text("small") },
  cardBody: {
    paddingHorizontal: space(3.5),
    paddingBottom: space(2.5),
    paddingTop: space(0.5),
    gap: space(2),
  },
  headRight: { flexDirection: "row", alignItems: "center", gap: space(2) },
  status: { borderRadius: radius.chip, paddingHorizontal: space(2), paddingVertical: space(0.5) },
  statusText: { ...text("micro"), fontWeight: "700" },
  description: { ...text("small") },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  chip: { borderRadius: radius.chip, paddingHorizontal: space(2), paddingVertical: space(0.5) },
  chipText: { ...text("micro"), fontWeight: "600" },
  reason: { ...text("small") },
  issues: { gap: space(0.5) },
  issueTitle: { ...text("micro"), fontWeight: "600" },
  issue: { ...text("micro") },
  // —— 面板/网页岛入口（MenuRow 补齐左右留白） ——
  entryGroup: { paddingVertical: space(1.5), gap: space(0.5) },
  entryLabel: {
    ...text("micro"),
    fontWeight: "700",
    paddingHorizontal: space(3),
    paddingTop: space(1),
    paddingBottom: space(0.5),
  },
  entryRight: { flexDirection: "row", alignItems: "center", gap: space(1) },
  panelDegraded: { ...text("micro"), fontWeight: "600" },
  // —— 设置与命令（Disclosure 式展开） ——
  details: {
    paddingHorizontal: space(3.5),
    paddingVertical: space(2),
    gap: space(2),
  },
  detailsHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: space(7.5),
  },
  detailsTitle: { ...text("small"), fontWeight: "700" },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  detailsBody: { gap: space(2.5) },
  detailsLabel: { ...text("micro"), fontWeight: "700" },
  detailsHint: { ...text("micro") },
  settingRow: { gap: space(1.5) },
  settingText: { gap: space(0.25) },
  settingTitle: { ...text("small"), fontWeight: "600" },
  settingDesc: { ...text("micro") },
  settingInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    ...text("small"),
  },
  selectRow: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  selectChip: {
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  selectChipText: { ...text("micro") },
  commands: { gap: space(1) },
  commandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space(2),
  },
  commandTitle: { flex: 1, ...text("small") },
  commandName: { ...text("small"), maxWidth: "55%" },
  note: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(3),
    gap: space(2),
    marginTop: space(2),
  },
  noteText: { ...text("micro") },
});
