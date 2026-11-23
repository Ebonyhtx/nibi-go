// 插件中心：内置与外部安装插件的启停、状态、环境变量配置、降级原因、面板入口与卸载。
//
// 只显示 manifest 与解析结果；插件代码不会在 UI 进程执行（MCP 工具在 `:kernel` 的
// 子进程里跑）。这里也是“为什么不能渲染”与“如何配置 MCP 环境变量”的统一入口。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { MenuRow } from "../components/ui/MenuRow";
import { Row } from "../components/ui/Row";
import { Divider, SectionCard } from "../components/ui/SectionCard";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { pickText, useI18n } from "../i18n";
import { useResponsiveBodyStyle } from "../layout/responsive";
import {
  pluginActionTitle,
  pluginDisplayDescription,
  pluginDisplayName,
  pluginSkillName,
} from "../plugins/builtinI18n";
import { uninstallMarketPlugin } from "../plugins/installer";
import { missingEnvVarNames, validatePluginEnvName } from "../plugins/npmRegistry";
import { usePlugins } from "../plugins/usePlugins";
import type { LoadedPlugin } from "../plugins/store";
import { AppearIn, staggerDelay } from "../motion/appear";
import { PressableScale } from "../motion/PressableScale";
import { radius, space, text, useNibiTheme } from "../theme";

function statusOf(plugin: LoadedPlugin): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (plugin.parsed.status === "invalid") {
    return { label: pickText("清单有误", "Invalid manifest"), tone: "danger" };
  }
  if (plugin.parsed.status === "incompatible") {
    return { label: pickText("不兼容", "Incompatible"), tone: "warn" };
  }
  if (plugin.licenseBlocked) {
    return { label: pickText("待授权", "License needed"), tone: "warn" };
  }
  if (!plugin.parsed.slotsAvailable) {
    return { label: pickText("已降级", "Degraded"), tone: "warn" };
  }
  if (!plugin.enabled) return { label: pickText("已停用", "Disabled"), tone: "muted" };
  return { label: pickText("可用", "Ready"), tone: "ok" };
}

function sourceBadgeOf(plugin: LoadedPlugin): string {
  if (plugin.bundled) return pickText("NIBI 内置", "Built-in");
  if (plugin.sourceMeta?.kind === "npm") {
    const pkg = plugin.sourceMeta.npmPackage?.trim();
    const title = plugin.parsed.manifest.name.trim();
    // 插件名已与 npm 包名相同时不再重复展示包名（避免 `amap-mcp-server` / `npm · amap-mcp-server` 重复）。
    if (pkg && pkg.toLowerCase() !== title.toLowerCase()) {
      return `npm · ${pkg}`;
    }
    return "npm MCP";
  }
  if (plugin.sourceMeta?.kind === "standard") return pickText("标准插件", "Standard plugin");
  if (plugin.sourceMeta?.kind === "skill-bundle") return pickText("技能包", "Skill pack");
  return pickText("已安装", "Installed");
}

function PluginCard({
  plugin,
  onToggle,
  onSetting,
  onSetEnv,
  onDeleteEnv,
  onRequestUninstall,
}: {
  plugin: LoadedPlugin;
  onToggle: (enabled: boolean) => void;
  onSetting: (key: string, value: string | boolean) => Promise<void>;
  onSetEnv: (name: string, value: string) => Promise<void>;
  onDeleteEnv: (name: string) => Promise<void>;
  onRequestUninstall?: () => void;
}) {
  const t = useNibiTheme();
  const { pick } = useI18n();
  const manifest = plugin.parsed.manifest;
  // 开关用本地状态先行，避免父级异步 reload 把 Switch 拉回旧值造成闪烁。
  const [enabled, setEnabled] = useState(plugin.enabled);
  useEffect(() => {
    setEnabled(plugin.enabled);
  }, [plugin.enabled]);
  const status = statusOf(plugin);
  const tone =
    status.tone === "ok"
      ? t.ok
      : status.tone === "warn"
        ? t.amber
        : status.tone === "danger"
          ? t.red
          : t.inkFaint;
  const toneSoft =
    status.tone === "ok"
      ? t.okSoft
      : status.tone === "warn"
        ? t.amberSoft
        : status.tone === "danger"
          ? t.redSoft
          : t.surfaceSoft;
  const panels = manifest.contributes.panels;
  const webIslands = manifest.contributes.webIslands;
  const canEnable = plugin.parsed.status === "ready" && plugin.parsed.slotsAvailable;
  const isMcp = manifest.runtime?.type === "mcp";
  const envMap = manifest.runtime?.envMap;

  // 设置与自定义环境变量：本地状态先行，提交后提示「新开会话生效」。
  const [values, setValues] = useState(plugin.settings);
  const committedSettingRef = useRef<Record<string, string>>({});
  useEffect(() => {
    setValues(plugin.settings);
    committedSettingRef.current = {};
  }, [plugin.settings]);
  const [customEnv, setCustomEnv] = useState<Record<string, string>>(plugin.customEnv);
  const committedEnvRef = useRef<Record<string, string>>({});
  useEffect(() => {
    setCustomEnv(plugin.customEnv);
    committedEnvRef.current = {};
  }, [plugin.customEnv]);

  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [envDrafts, setEnvDrafts] = useState<Record<string, string>>({});
  const [addingEnv, setAddingEnv] = useState(false);
  const [newEnvName, setNewEnvName] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [envError, setEnvError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const settings = manifest.settings ?? [];
  const settingIdByEnvName = useMemo(() => {
    const map = new Map<string, string>();
    for (const [settingId, envName] of Object.entries(envMap ?? {})) {
      map.set(envName, settingId);
    }
    return map;
  }, [envMap]);

  const extraEnvEntries = useMemo(() => {
    const list: Array<{ name: string; detected: boolean }> = [];
    const seen = new Set<string>();
    for (const name of plugin.detectedEnvVars ?? []) {
      if (settingIdByEnvName.has(name) || seen.has(name)) continue;
      seen.add(name);
      list.push({ name, detected: true });
    }
    for (const name of Object.keys(customEnv).sort()) {
      if (settingIdByEnvName.has(name) || seen.has(name)) continue;
      seen.add(name);
      list.push({ name, detected: false });
    }
    return list;
  }, [plugin.detectedEnvVars, customEnv, settingIdByEnvName]);

  const missingEnvs = useMemo(
    () =>
      isMcp
        ? missingEnvVarNames({
            settings: values,
            envMap,
            customEnv,
            detectedEnvVars: plugin.detectedEnvVars,
          })
        : [],
    [isMcp, values, envMap, customEnv, plugin.detectedEnvVars],
  );

  const configuredEnvCount = useMemo(() => {
    if (!isMcp) return 0;
    const filled = new Set<string>();
    for (const [settingId, envName] of Object.entries(envMap ?? {})) {
      const raw = values[settingId];
      if (raw !== undefined && String(raw).trim().length > 0) filled.add(envName);
    }
    for (const [envName, raw] of Object.entries(customEnv)) {
      if (raw.trim().length > 0) filled.add(envName);
    }
    return filled.size;
  }, [isMcp, envMap, values, customEnv]);

  const displayName = pluginDisplayName(manifest.id, manifest.name);
  const displayDescription = pluginDisplayDescription(manifest.id, manifest.description);
  const commands: Array<{ key: string; title: string; name: string }> = [];
  const commandNames = new Set<string>();
  const addCommand = (key: string, title: string, name: string) => {
    if (!name || commandNames.has(name)) return;
    commandNames.add(name);
    commands.push({ key, title: title.trim() || name, name });
  };
  for (const action of manifest.contributes.composerActions) {
    if (action.token?.kind === "command") {
      addCommand(
        `a:${action.id}`,
        pluginActionTitle(manifest.id, action.id, action.title),
        action.token.value,
      );
    }
  }
  for (const action of manifest.contributes.composerTools) {
    if (action.token?.kind === "command") {
      addCommand(
        `t:${action.id}`,
        pluginActionTitle(manifest.id, action.id, action.title),
        action.token.value,
      );
    }
  }
  for (const action of manifest.contributes.messageActions) {
    if (action.command) {
      addCommand(
        `m:${action.id}`,
        pluginActionTitle(manifest.id, action.id, action.title),
        action.command,
      );
    }
  }
  const skills = manifest.skills ?? [];
  const hasDetails = isMcp || settings.length > 0 || commands.length > 0 || skills.length > 0;

  const commitSetting = async (key: string, value: string | boolean, label?: string) => {
    if (typeof value === "string") {
      committedSettingRef.current[key] = value.trim();
    }
    setValues((current) => ({ ...current, [key]: value }));
    setEnvError(null);
    const mappedEnv = envMap?.[key];
    try {
      // 若之前曾用自定义 env 存过同名变量，更新/清空清单映射项时同步清理旧覆盖，保持单一真相。
      if (mappedEnv && mappedEnv in customEnv) {
        setCustomEnv((current) => {
          const next = { ...current };
          delete next[mappedEnv];
          return next;
        });
        await onDeleteEnv(mappedEnv);
      }
      await onSetting(key, value);
      if (isMcp) {
        const suffix = label ? ` ${label}` : "";
        const empty = typeof value === "string" && value.trim().length === 0;
        setSaveNotice(
          empty
            ? pick(`已清空${suffix}，新开会话生效`, `Cleared${suffix}; applies to new sessions`)
            : pick(`已保存${suffix}，新开会话生效`, `Saved${suffix}; applies to new sessions`),
        );
      }
    } catch (error) {
      setEnvError(error instanceof Error ? error.message : String(error));
    }
  };

  const commitEnv = async (name: string, rawValue: string) => {
    const trimmed = rawValue.trim();
    const mappedSettingId = settingIdByEnvName.get(name);
    if (mappedSettingId) {
      setEnvDrafts((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
      await commitSetting(mappedSettingId, trimmed, name);
      return;
    }
    committedEnvRef.current[name] = trimmed;
    setEnvError(null);
    setCustomEnv((current) => {
      const next = { ...current };
      if (trimmed.length === 0) delete next[name];
      else next[name] = trimmed;
      return next;
    });
    setEnvDrafts((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
    try {
      await onSetEnv(name, trimmed);
      setSaveNotice(
        trimmed.length > 0
          ? pick(`已保存 ${name}，新开会话生效`, `Saved ${name}; applies to new sessions`)
          : pick(`已清空 ${name}，新开会话生效`, `Cleared ${name}; applies to new sessions`),
      );
    } catch (error) {
      setEnvError(error instanceof Error ? error.message : String(error));
    }
  };

  const removeEnv = async (name: string) => {
    setEnvError(null);
    setCustomEnv((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
    setEnvDrafts((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
    try {
      await onDeleteEnv(name);
      setSaveNotice(
        pick(`已删除 ${name}，新开会话生效`, `Removed ${name}; applies to new sessions`),
      );
    } catch (error) {
      setEnvError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleAddEnv = async () => {
    const validated = validatePluginEnvName(newEnvName);
    if (!validated.ok) {
      setEnvError(validated.reason);
      return;
    }
    const trimmedValue = newEnvValue.trim();
    if (!trimmedValue) {
      setEnvError(pick(`请输入 ${validated.name} 的值`, `Enter a value for ${validated.name}`));
      return;
    }
    Keyboard.dismiss();
    await commitEnv(validated.name, trimmedValue);
    setNewEnvName("");
    setNewEnvValue("");
    setAddingEnv(false);
  };

  const detailsTitle = isMcp
    ? pick("环境变量与设置", "Environment & settings")
    : pick("设置与命令", "Settings & commands");

  return (
    <SectionCard>
      <Row
        title={displayName}
        detail={`v${manifest.version} · ${sourceBadgeOf(plugin)}`}
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
              accessibilityLabel={pick(`启用 ${displayName}`, `Enable ${displayName}`)}
            />
          </View>
        }
      />

      <View style={styles.cardBody}>
        {displayDescription ? (
          <Text style={[styles.description, { color: t.inkSub }]}>{displayDescription}</Text>
        ) : null}

        {plugin.parsed.degraded.length > 0 ? (
          <View style={styles.chips}>
            <View style={[styles.chip, { backgroundColor: t.amberSoft }]}>
              <Text style={[styles.chipText, { color: t.amber }]}>{pick("已降级", "Degraded")}</Text>
            </View>
          </View>
        ) : null}

        {plugin.parsed.reason ? (
          <Text style={[styles.reason, { color: tone }]}>{plugin.parsed.reason}</Text>
        ) : null}

        {plugin.parsed.issues.length > 0 ? (
          <View style={styles.issues}>
            <Text style={[styles.issueTitle, { color: t.amber }]}>
              {pick(
                `${plugin.parsed.issues.length} 项有误（可用部分仍生效）`,
                `${plugin.parsed.issues.length} issues (working parts remain active)`,
              )}
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
            <Text style={[styles.entryLabel, { color: t.inkFaint }]}>{pick("面板", "Panels")}</Text>
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
                      <View style={styles.entryRight}>
                        <Text style={[styles.panelDegraded, { color: t.amber }]}>
                          {pick("已降级", "Degraded")}
                        </Text>
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
            <Text style={[styles.entryLabel, { color: t.inkFaint }]}>{pick("网页", "Web views")}</Text>
            {webIslands.map((island) => (
              <MenuRow
                key={island.id}
                icon="globe"
                tone="steel"
                label={island.title}
                detail={pick("内置网页", "Built-in web view")}
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
              accessibilityLabel={pick(
                `${showDetails ? "收起" : "展开"} ${displayName} 的${detailsTitle}`,
                `${showDetails ? "Collapse" : "Expand"} ${detailsTitle} for ${displayName}`,
              )}
              style={styles.detailsHead}
            >
              <View style={styles.detailsHeadLeft}>
                <Text style={[styles.detailsTitle, { color: t.inkSub }]}>{detailsTitle}</Text>
                {isMcp && missingEnvs.length > 0 ? (
                  <View style={[styles.envBadge, { backgroundColor: t.amberSoft }]}>
                    <Text style={[styles.envBadgeText, { color: t.amber }]} numberOfLines={1}>
                      {pick("待配", "Needs")} {missingEnvs[0]}
                      {missingEnvs.length > 1 ? ` +${missingEnvs.length - 1}` : ""}
                    </Text>
                  </View>
                ) : isMcp && configuredEnvCount > 0 ? (
                  <View style={[styles.envBadge, { backgroundColor: t.okSoft }]}>
                    <Text style={[styles.envBadgeText, { color: t.ok }]}>
                      {pick(`已配 ${configuredEnvCount} 项`, `${configuredEnvCount} set`)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={showDetails ? styles.chevronOpen : undefined}>
                <Icon name="chevron-down" size={13} color={t.inkFaint} />
              </View>
            </PressableScale>

            {showDetails ? (
              <View style={styles.detailsBody}>
                {settings.map((setting) => {
                  const mappedEnv = envMap?.[setting.id];
                  const savedText =
                    String(values[setting.id] ?? "").trim() ||
                    (mappedEnv ? (customEnv[mappedEnv] ?? "") : "");
                  const draftText = textDrafts[setting.id];
                  const currentText = draftText ?? savedText;
                  const dirty = draftText !== undefined && draftText.trim() !== savedText.trim();
                  const hasValue = savedText.trim().length > 0;
                  return (
                    <View key={setting.id} style={styles.settingRow}>
                      <View style={styles.settingHeadRow}>
                        <View style={styles.settingText}>
                          <View style={styles.envNameRow}>
                            <Text style={[styles.settingTitle, { color: t.ink }]}>
                              {setting.title}
                            </Text>
                            {mappedEnv && mappedEnv !== setting.title ? (
                              <View style={[styles.miniPill, { backgroundColor: t.panel }]}>
                                <Text style={[styles.miniPillText, { color: t.inkFaint }]}>
                                  {mappedEnv}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          {setting.description ? (
                            <Text style={[styles.settingDesc, { color: t.inkFaint }]}>
                              {setting.description}
                            </Text>
                          ) : null}
                        </View>
                        {mappedEnv ? (
                          <View
                            style={[
                              styles.miniPill,
                              { backgroundColor: hasValue ? t.okSoft : t.amberSoft },
                            ]}
                          >
                            <Text
                              style={[
                                styles.miniPillText,
                                { color: hasValue ? t.ok : t.amber },
                              ]}
                            >
                              {hasValue ? pick("已配置", "Set") : pick("待填写", "Required")}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {setting.type === "toggle" ? (
                        <Switch
                          value={values[setting.id] === true}
                          onValueChange={(value) => {
                            void commitSetting(setting.id, value, setting.title);
                          }}
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
                                onPress={() => {
                                  void commitSetting(setting.id, option.value, setting.title);
                                }}
                                scaleTo={0.95}
                                style={[
                                  styles.selectChip,
                                  {
                                    backgroundColor: active ? t.brandSoft : t.surfaceSoft,
                                    borderColor: active ? t.brand : t.hairline,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.selectChipText,
                                    { color: active ? t.brand : t.inkSub },
                                  ]}
                                >
                                  {option.label}
                                </Text>
                              </PressableScale>
                            );
                          })}
                        </View>
                      ) : null}
                      {setting.type === "text" ? (
                        <View style={styles.inputActionRow}>
                          <TextInput
                            value={currentText}
                            onChangeText={(value) =>
                              setTextDrafts((current) => ({ ...current, [setting.id]: value }))
                            }
                            onSubmitEditing={() => {
                              const nextVal = (textDrafts[setting.id] ?? savedText).trim();
                              setTextDrafts((current) => {
                                const copy = { ...current };
                                delete copy[setting.id];
                                return copy;
                              });
                              if (nextVal !== savedText.trim()) {
                                void commitSetting(setting.id, nextVal, mappedEnv ?? setting.title);
                              }
                            }}
                            onBlur={() => {
                              const draft = textDrafts[setting.id];
                              const baseline = committedSettingRef.current[setting.id] ?? savedText.trim();
                              if (draft !== undefined && draft.trim() !== baseline) {
                                void commitSetting(
                                  setting.id,
                                  draft.trim(),
                                  mappedEnv ?? setting.title,
                                );
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
                            returnKeyType="done"
                            accessibilityLabel={setting.title}
                            style={[
                              styles.settingInput,
                              styles.inputFlex,
                              {
                                color: t.ink,
                                borderColor: dirty ? t.brand : t.hairline,
                                backgroundColor: t.surfaceSoft,
                              },
                            ]}
                          />
                          {dirty ? (
                            <PressableScale
                              scaleTo={0.95}
                              onPress={() => {
                                const nextVal = (textDrafts[setting.id] ?? "").trim();
                                setTextDrafts((current) => {
                                  const copy = { ...current };
                                  delete copy[setting.id];
                                  return copy;
                                });
                                void commitSetting(
                                  setting.id,
                                  nextVal,
                                  mappedEnv ?? setting.title,
                                );
                                Keyboard.dismiss();
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={pick(
                                `保存 ${mappedEnv ?? setting.title}`,
                                `Save ${mappedEnv ?? setting.title}`,
                              )}
                              style={[styles.inlineSaveBtn, { backgroundColor: t.brand }]}
                            >
                              <Text style={[styles.inlineSaveText, { color: t.brandFg }]}>
                                {pick("保存", "Save")}
                              </Text>
                            </PressableScale>
                          ) : mappedEnv && hasValue ? (
                            <PressableScale
                              scaleTo={0.94}
                              onPress={() => {
                                void commitSetting(setting.id, "", mappedEnv);
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={pick(`清空 ${mappedEnv}`, `Clear ${mappedEnv}`)}
                              hitSlop={6}
                              style={[styles.iconActionBtn, { backgroundColor: t.surfaceSoft }]}
                            >
                              <Icon name="x" size={13} color={t.inkFaint} />
                            </PressableScale>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}

                {isMcp ? (
                  <View style={styles.envSection}>
                    <View style={styles.envSectionHead}>
                      <Text style={[styles.detailsLabel, { color: t.inkFaint }]}>
                        {Object.keys(envMap ?? {}).length > 0
                          ? pick("自定义环境变量", "Custom env vars")
                          : pick("环境变量", "Environment variables")}
                      </Text>
                      {!addingEnv ? (
                        <PressableScale
                          scaleTo={0.95}
                          onPress={() => {
                            setEnvError(null);
                            setAddingEnv(true);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={pick(
                            `为 ${manifest.name} 添加环境变量`,
                            `Add env var for ${manifest.name}`,
                          )}
                          style={[styles.addEnvBtn, { backgroundColor: t.brandSoft }]}
                        >
                          <Icon name="plus" size={12} color={t.brand} />
                          <Text style={[styles.addEnvText, { color: t.brand }]}>
                            {pick("添加变量", "Add var")}
                          </Text>
                        </PressableScale>
                      ) : null}
                    </View>

                    {extraEnvEntries.length === 0 &&
                    !addingEnv &&
                    Object.keys(envMap ?? {}).length === 0 ? (
                      <Text style={[styles.detailsHint, { color: t.inkFaint }]}>
                        {pick(
                          "暂未配置环境变量。若该 MCP 需要 API Key / Token，点击右上「添加变量」填入即可。",
                          "No environment variables configured. If this MCP needs an API key or token, tap Add var above.",
                        )}
                      </Text>
                    ) : null}

                    {extraEnvEntries.map(({ name, detected }) => {
                      const savedValue = customEnv[name] ?? "";
                      const draftValue = envDrafts[name];
                      const currentValue = draftValue ?? savedValue;
                      const dirty =
                        draftValue !== undefined && draftValue.trim() !== savedValue.trim();
                      const hasSaved = savedValue.trim().length > 0;
                      return (
                        <View key={name} style={styles.settingRow}>
                          <View style={styles.settingHeadRow}>
                            <View style={styles.envNameRow}>
                              <Text style={[styles.settingTitle, { color: t.ink }]}>{name}</Text>
                              {hasSaved ? (
                                <View style={[styles.miniPill, { backgroundColor: t.okSoft }]}>
                                  <Text style={[styles.miniPillText, { color: t.ok }]}>
                                    {pick("已配置", "Set")}
                                  </Text>
                                </View>
                              ) : detected ? (
                                <View style={[styles.miniPill, { backgroundColor: t.amberSoft }]}>
                                  <Text style={[styles.miniPillText, { color: t.amber }]}>
                                    {pick("自动探测", "Detected")}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            {hasSaved ? (
                              <PressableScale
                                scaleTo={0.92}
                                onPress={() => {
                                  void removeEnv(name);
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={pick(`删除环境变量 ${name}`, `Delete env var ${name}`)}
                                hitSlop={6}
                                style={styles.deleteEnvIcon}
                              >
                                <Icon name="trash" size={13} color={t.inkFaint} />
                              </PressableScale>
                            ) : null}
                          </View>
                          <View style={styles.inputActionRow}>
                            <TextInput
                              value={currentValue}
                              onChangeText={(value) =>
                                setEnvDrafts((current) => ({ ...current, [name]: value }))
                              }
                              onSubmitEditing={() => {
                                const val = envDrafts[name];
                                if (val !== undefined && val.trim() !== savedValue.trim()) {
                                  void commitEnv(name, val);
                                }
                              }}
                              onBlur={() => {
                                const val = envDrafts[name];
                                const baseline = committedEnvRef.current[name] ?? savedValue.trim();
                                if (val !== undefined && val.trim() !== baseline) {
                                  void commitEnv(name, val);
                                } else {
                                  setEnvDrafts((current) => {
                                    const copy = { ...current };
                                    delete copy[name];
                                    return copy;
                                  });
                                }
                              }}
                              placeholder={pick(`填写 ${name}`, `Enter ${name}`)}
                              placeholderTextColor={t.inkFaint}
                              autoCapitalize="none"
                              autoCorrect={false}
                              returnKeyType="done"
                              accessibilityLabel={name}
                              style={[
                                styles.settingInput,
                                styles.inputFlex,
                                {
                                  color: t.ink,
                                  borderColor: dirty ? t.brand : t.hairline,
                                  backgroundColor: t.surfaceSoft,
                                },
                              ]}
                            />
                            {dirty ? (
                              <PressableScale
                                scaleTo={0.95}
                                onPress={() => {
                                  void commitEnv(name, envDrafts[name] ?? "");
                                  Keyboard.dismiss();
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={pick(`保存环境变量 ${name}`, `Save env var ${name}`)}
                                style={[styles.inlineSaveBtn, { backgroundColor: t.brand }]}
                              >
                                <Text style={[styles.inlineSaveText, { color: t.brandFg }]}>
                                  {pick("保存", "Save")}
                                </Text>
                              </PressableScale>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}

                    {addingEnv ? (
                      <View
                        style={[
                          styles.addEnvForm,
                          { backgroundColor: t.panel, borderColor: t.hairline },
                        ]}
                      >
                        <TextInput
                          value={newEnvName}
                          onChangeText={(value) => {
                            setNewEnvName(value.toUpperCase().replace(/[^A-Z0-9_]/gu, ""));
                            setEnvError(null);
                          }}
                          placeholder={pick("变量名（例如 AMAP_KEY）", "Variable name (e.g. API_KEY)")}
                          placeholderTextColor={t.inkFaint}
                          autoCapitalize="characters"
                          autoCorrect={false}
                          maxLength={64}
                          accessibilityLabel={pick("环境变量名", "Environment variable name")}
                          style={[
                            styles.settingInput,
                            {
                              color: t.ink,
                              borderColor: t.hairline,
                              backgroundColor: t.card,
                            },
                          ]}
                        />
                        <TextInput
                          value={newEnvValue}
                          onChangeText={(value) => {
                            setNewEnvValue(value);
                            setEnvError(null);
                          }}
                          placeholder={pick("变量值（API Key / Token 等）", "Value (API key, token, etc.)")}
                          placeholderTextColor={t.inkFaint}
                          autoCapitalize="none"
                          autoCorrect={false}
                          returnKeyType="done"
                          onSubmitEditing={() => {
                            void handleAddEnv();
                          }}
                          accessibilityLabel={pick("环境变量值", "Environment variable value")}
                          style={[
                            styles.settingInput,
                            {
                              color: t.ink,
                              borderColor: t.hairline,
                              backgroundColor: t.card,
                            },
                          ]}
                        />
                        <View style={styles.addEnvActions}>
                          <PressableScale
                            scaleTo={0.96}
                            onPress={() => {
                              setAddingEnv(false);
                              setNewEnvName("");
                              setNewEnvValue("");
                              setEnvError(null);
                            }}
                            accessibilityRole="button"
                            style={[
                              styles.addFormBtn,
                              { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
                            ]}
                          >
                            <Text style={[styles.addFormBtnText, { color: t.inkSub }]}>
                              {pick("取消", "Cancel")}
                            </Text>
                          </PressableScale>
                          <PressableScale
                            scaleTo={0.96}
                            onPress={() => {
                              void handleAddEnv();
                            }}
                            accessibilityRole="button"
                            style={[
                              styles.addFormBtn,
                              { backgroundColor: t.brand, borderColor: t.brand },
                            ]}
                          >
                            <Text style={[styles.addFormBtnText, { color: t.brandFg }]}>
                              {pick("保存", "Save")}
                            </Text>
                          </PressableScale>
                        </View>
                      </View>
                    ) : null}

                    {envError ? (
                      <Text style={[styles.envErrorText, { color: t.red }]}>{envError}</Text>
                    ) : null}

                    {saveNotice ? (
                      <View style={[styles.saveNotice, { backgroundColor: t.okSoft }]}>
                        <Icon name="check" size={12} color={t.ok} />
                        <Text style={[styles.saveNoticeText, { color: t.ok }]}>{saveNotice}</Text>
                      </View>
                    ) : null}

                    <Text style={[styles.detailsHint, { color: t.inkGhost }]}>
                      {pick(
                        "环境变量仅注入本插件的 MCP 子进程；修改后请新开会话生效。",
                        "Variables are only passed to this plugin's MCP subprocess. Start a new chat for changes to apply.",
                      )}
                    </Text>
                  </View>
                ) : null}

                {commands.length > 0 ? (
                  <View style={styles.commands}>
                    <Text style={[styles.detailsLabel, { color: t.inkFaint }]}>
                      {pick("命令", "Commands")}
                    </Text>
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
                      {pick(
                        "在对话里输入 /命令名 或从加号菜单触发。",
                        "Type /command in chat or pick it from the + menu.",
                      )}
                    </Text>
                  </View>
                ) : null}

                {skills.length > 0 ? (
                  <View style={styles.commands}>
                    <Text style={[styles.detailsLabel, { color: t.inkFaint }]}>
                      {pick("技能", "Skills")}
                    </Text>
                    {skills.map((skill) => (
                      <View key={skill.id} style={styles.commandRow}>
                        <Text style={[styles.commandTitle, { color: t.inkSub }]} numberOfLines={1}>
                          {pluginSkillName(manifest.id, skill.id, skill.name ?? skill.id)}
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

      {!plugin.bundled && onRequestUninstall ? (
        <>
          <Divider />
          <View style={styles.cardFooter}>
            <Text style={[styles.footerMeta, { color: t.inkGhost }]} numberOfLines={1}>
              {isMcp && manifest.runtime
                ? `${pick("MCP 服务", "MCP server")} · ${manifest.runtime.serverName}`
                : pick("已安装扩展", "Installed extension")}
            </Text>
            <PressableScale
              scaleTo={0.95}
              onPress={onRequestUninstall}
              accessibilityRole="button"
              accessibilityLabel={pick(`卸载 ${displayName}`, `Uninstall ${displayName}`)}
              style={[styles.uninstallBtn, { backgroundColor: t.redSoft }]}
            >
              <Icon name="trash" size={12} color={t.red} />
              <Text style={[styles.uninstallText, { color: t.red }]}>
                {pick("卸载", "Uninstall")}
              </Text>
            </PressableScale>
          </View>
        </>
      ) : null}
    </SectionCard>
  );
}

export default function PluginsScreen() {
  const t = useNibiTheme();
  const { pick } = useI18n();
  const insets = useSafeAreaInsets();
  const bodyStyle = useResponsiveBodyStyle({
    paddingTop: space(2),
    paddingBottom: insets.bottom + space(6),
    gap: space(3),
  });
  const plugins = usePlugins();
  const [uninstallTarget, setUninstallTarget] = useState<LoadedPlugin | null>(null);
  const [uninstalling, setUninstalling] = useState(false);

  // 从首页带着输入框焦点进来时，键盘会弹一下又收回去；进入插件中心先明确收起。
  useFocusEffect(
    useCallback(() => {
      Keyboard.dismiss();
    }, []),
  );

  const handleConfirmUninstall = async () => {
    if (!uninstallTarget || uninstalling) return;
    setUninstalling(true);
    try {
      await uninstallMarketPlugin(uninstallTarget.dir);
      await plugins.reload();
      setUninstallTarget(null);
    } catch (error) {
      console.warn("[nibigo] 插件卸载失败", error);
      setUninstallTarget(null);
    } finally {
      setUninstalling(false);
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[t.glowTop, t.bgGradient[0], t.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader
        title={pick("插件", "Plugins")}
        onBack={() => router.back()}
        right={
          // 市场入口带店形图标 + 全名：只写「市场」两个字没人知道是插件市场
          // （运营者 2026-11-22：容易误会）。
          <PressableScale
            onPress={() => router.push("/market")}
            accessibilityRole="button"
            accessibilityLabel={pick("打开插件市场", "Open plugin marketplace")}
            style={[styles.marketButton, { backgroundColor: t.brandSoft }]}
          >
            <Icon name="store" size={12} color={t.brand} />
            <Text style={[styles.marketText, { color: t.brand }]}>
              {pick("插件市场", "Marketplace")}
            </Text>
          </PressableScale>
        }
      />

      <ScrollView
        contentContainerStyle={bodyStyle}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {plugins.loading && plugins.plugins.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={t.brand} />
            <Text style={[styles.loadingText, { color: t.inkFaint }]}>
              {pick("读取插件清单…", "Loading plugin manifests…")}
            </Text>
          </View>
        ) : null}

        {plugins.error ? (
          <Text style={[styles.error, { color: t.red }]}>{plugins.error}</Text>
        ) : null}

        {plugins.plugins.map((plugin, index) => (
          <AppearIn key={plugin.dir} delay={staggerDelay(index, 32, 240)}>
            <PluginCard
              plugin={plugin}
              onSetting={async (key, value) => {
                const id = plugin.parsed.manifest.id;
                try {
                  await plugins.setSetting(id, key, value);
                } catch (error: unknown) {
                  plugins.reload().catch(() => undefined);
                  console.warn("[nibigo] 插件设置保存失败", error);
                  throw error;
                }
              }}
              onSetEnv={async (name, value) => {
                const id = plugin.parsed.manifest.id;
                try {
                  await plugins.setEnvVar(id, name, value);
                } catch (error: unknown) {
                  plugins.reload().catch(() => undefined);
                  console.warn("[nibigo] 插件环境变量保存失败", error);
                  throw error;
                }
              }}
              onDeleteEnv={async (name) => {
                const id = plugin.parsed.manifest.id;
                try {
                  await plugins.deleteEnvVar(id, name);
                } catch (error: unknown) {
                  plugins.reload().catch(() => undefined);
                  console.warn("[nibigo] 插件环境变量删除失败", error);
                  throw error;
                }
              }}
              onToggle={(enabled) => {
                const id = plugin.parsed.manifest.id;
                void plugins.setEnabled(id, enabled).catch((error: unknown) => {
                  plugins.reload().catch(() => undefined);
                  console.warn("[nibigo] 插件启停失败", error);
                });
              }}
              onRequestUninstall={
                plugin.bundled ? undefined : () => setUninstallTarget(plugin)
              }
            />
          </AppearIn>
        ))}

        {plugins.plugins.length === 0 && !plugins.loading && !plugins.error ? (
          <AppearIn delay={staggerDelay(0, 32, 240)}>
            <View style={[styles.note, { borderColor: t.hairline }]}>
              <Text style={[styles.noteText, { color: t.inkFaint }]}>
                {pick(
                  "插件只能显示受限内容，无法更改应用权限。去「插件市场」安装更多插件。",
                  "Plugins run with limited UI and cannot change app permissions. Browse the Marketplace to install more.",
                )}
              </Text>
            </View>
          </AppearIn>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={uninstallTarget !== null}
        danger
        title={pick(
          `卸载「${uninstallTarget?.parsed.manifest.name ?? ""}」？`,
          `Uninstall "${uninstallTarget?.parsed.manifest.name ?? ""}"?`,
        )}
        message={pick(
          "将删除本地插件目录，已保存的环境变量与设置会保留，重新安装后可沿用。",
          "Removes the local plugin files. Saved environment variables and settings are preserved if you reinstall later.",
        )}
        confirmLabel={uninstalling ? pick("卸载中…", "Uninstalling…") : pick("卸载", "Uninstall")}
        onCancel={() => {
          if (!uninstalling) setUninstallTarget(null);
        }}
        onConfirm={() => {
          void handleConfirmUninstall();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  marketButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
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
  // —— 面板/网页岛入口 ——
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
  // —— 环境变量、设置与命令（Disclosure 式展开） ——
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
    gap: space(2),
  },
  detailsHeadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    flex: 1,
    minWidth: 0,
  },
  detailsTitle: { ...text("small"), fontWeight: "700" },
  envBadge: {
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: space(0.5),
    maxWidth: "60%",
  },
  envBadgeText: { ...text("micro"), fontWeight: "600" },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  detailsBody: { gap: space(2.5) },
  detailsLabel: { ...text("micro"), fontWeight: "700" },
  detailsHint: { ...text("micro") },
  settingRow: { gap: space(1.5) },
  settingHeadRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space(2),
  },
  settingText: { flex: 1, gap: space(0.25) },
  envNameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space(1.5),
  },
  settingTitle: { ...text("small"), fontWeight: "600" },
  settingDesc: { ...text("micro") },
  miniPill: {
    borderRadius: radius.chip,
    paddingHorizontal: space(1.5),
    paddingVertical: 2,
  },
  miniPillText: { ...text("micro"), fontWeight: "600" },
  inputActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
  },
  inputFlex: { flex: 1 },
  settingInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    ...text("small"),
  },
  inlineSaveBtn: {
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.75),
    alignItems: "center",
    justifyContent: "center",
  },
  inlineSaveText: { ...text("micro"), fontWeight: "700" },
  iconActionBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  envSection: { gap: space(2) },
  envSectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  addEnvBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: space(0.75),
  },
  addEnvText: { ...text("micro"), fontWeight: "700" },
  deleteEnvIcon: {
    padding: space(0.75),
  },
  addEnvForm: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2.5),
    gap: space(2),
  },
  addEnvActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space(2),
  },
  addFormBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    alignItems: "center",
    justifyContent: "center",
  },
  addFormBtnText: { ...text("micro"), fontWeight: "700" },
  envErrorText: { ...text("micro"), fontWeight: "600" },
  saveNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
  },
  saveNoticeText: { ...text("micro"), fontWeight: "600", flex: 1 },
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
  // —— 非内置插件底部快捷卸载条 ——
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space(3.5),
    paddingVertical: space(2),
    gap: space(2),
  },
  footerMeta: { ...text("micro"), flex: 1 },
  uninstallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  uninstallText: { ...text("micro"), fontWeight: "700" },
  note: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(3),
    gap: space(2),
    marginTop: space(2),
  },
  noteText: { ...text("micro") },
});
