// 插件市场：分为「NIBI / 公开 / 个人」三个子页，顶部支持一键切换「国内源 / 国外源」。
//
// - NIBI：NIBI-GO 官方原生插件套件（Word / Excel / PPT / PDF 文档四件套、图表与可视化、写作与办公助手）及官方扩展；
// - 公开：来自公开镜像源（国内 jsDelivr + npmmirror / 国外 GitHub Raw + npmjs）的开源与社区插件；
// - 个人：用户自定义添加的插件包直链 / 镜像地址，或从手机本地导入的 .zip 插件包。
//
// 界面静态零「付费 / 会员」字样：所有未安装插件统一展示「安装」；
// 仅在点击「安装」且该插件需要账号授权时，才按需校验登录态与授权，未获权时弹出应用内嵌 handoff WebView。

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { strToU8, zipSync } from "fflate";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { comparePluginVersions, type MarketPluginEntry } from "@nibi-go/market-index";

import { Icon } from "../components/Icon";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MembershipSheet } from "../components/MembershipSheet";
import { PillButton } from "../components/ui/PillButton";
import { Row } from "../components/ui/Row";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { Divider, SectionCard } from "../components/ui/SectionCard";
import { SegmentedControl, type SegmentedOption } from "../components/ui/SegmentedControl";
import { Sheet } from "../components/ui/Sheet";
import { AppearIn, staggerDelay } from "../motion/appear";
import { PressableScale } from "../motion/PressableScale";
import {
  installMarketPlugin,
  installPersonalUrlPlugin,
  installPluginArchiveBytes,
  readInstalledManifest,
  uninstallMarketPlugin,
} from "../plugins/installer";
import { ensureLicenseLoaded, pluginLicenseDecision } from "../plugins/license";
import { syncLicense } from "../plugins/licenseSync";
import {
  currentMarketRegion,
  loadMarketRegion,
  marketRegionLabel,
  saveMarketRegion,
  type MarketRegion,
} from "../plugins/marketSource";
import {
  isOfficialNibiMarketEntry,
  loadPersonalSources,
  readMarketSnapshot,
  refreshMarket,
  savePersonalSources,
  visibleMarketEntries,
  type MarketSnapshotFile,
  type PersonalPluginSource,
} from "../plugins/marketStore";
import { BUNDLED_PLUGINS } from "../plugins/samples";
import { usePlugins } from "../plugins/usePlugins";
import { useSession } from "../relay/useSession";
import { radius, size, space, text, useNibiTheme } from "../theme";

type MarketTab = "nibi" | "public" | "personal";

const MARKET_TABS: readonly SegmentedOption<MarketTab>[] = [
  { value: "nibi", label: "NIBI" },
  { value: "public", label: "公开" },
  { value: "personal", label: "个人" },
];

interface CuratedPublicPlugin {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string;
  files: Record<string, string>;
}

/**
 * 公开子页内置的开源实用插件包（支持离线/在线一键打包安装到 filesDir/plugins/<id>，
 * 同时与远端公开镜像索引拉取到的社区插件合并展示）。
 */
const CURATED_PUBLIC_PLUGINS: readonly CuratedPublicPlugin[] = [
  {
    id: "open.git-workflow",
    name: "Git 变更与提交审阅",
    version: "1.0.0",
    publisher: "Open Community",
    description: "梳理工作区 Git 变更差异、按 Conventional Commits 规范生成提交说明并排查潜在冲突。",
    files: {
      "nibi-go.plugin.json": JSON.stringify(
        {
          schemaVersion: 1,
          id: "open.git-workflow",
          name: "Git 变更与提交审阅",
          version: "1.0.0",
          description: "梳理工作区 Git 变更差异、按规范生成提交说明并排查潜在冲突。",
          minApp: "0.1.0",
          accent: "brand",
          caps: ["view.v1", "slots.v1", "effects.v1"],
          skills: [
            {
              id: "commit-review",
              name: "Git 提交审阅",
              description: "审阅工作区代码变更并生成规范的提交说明。",
              body: "# Git 变更审阅与提交规范\n\n审阅代码变更时，先归纳核心意图与影响面，指出破坏性改动或遗漏测试，再给出 `type(scope): subject` 格式的提交说明。",
            },
          ],
          contributes: {
            "composer.actions": [
              {
                id: "draft-commit",
                title: "提交说明",
                icon: "checklist",
                token: { kind: "command", value: "open-git-draft-commit" },
                skills: ["open.git-workflow:commit-review"],
                prompt: "请检查当前项目的改动内容，审阅潜在问题并按 Conventional Commits 规范拟定清晰的 Git 提交说明。\n$ARGUMENTS",
              },
            ],
          },
        },
        null,
        2,
      ),
    },
  },
  {
    id: "open.api-inspector",
    name: "HTTP 接口联调助手",
    version: "1.0.0",
    publisher: "Open Community",
    description: "快速构造 REST / GraphQL 请求参数、解析响应结构并生成接口联调诊断报告。",
    files: {
      "nibi-go.plugin.json": JSON.stringify(
        {
          schemaVersion: 1,
          id: "open.api-inspector",
          name: "HTTP 接口联调助手",
          version: "1.0.0",
          description: "快速构造 REST / GraphQL 请求参数、解析响应结构并生成接口联调诊断报告。",
          minApp: "0.1.0",
          accent: "steel",
          caps: ["view.v1", "slots.v1", "effects.v1"],
          skills: [
            {
              id: "api-debug",
              name: "接口联调诊断",
              description: "核对 HTTP 请求头、入参、状态码与响应结构。",
              body: "# HTTP 接口联调诊断\n\n针对接口请求异常，依次核对鉴权头、Content-Type、路径参数、超时与幂等性，并给出可直接复现的验证步骤。",
            },
          ],
          contributes: {
            "composer.actions": [
              {
                id: "inspect-api",
                title: "接口排查",
                icon: "globe",
                token: { kind: "command", value: "open-api-inspect" },
                skills: ["open.api-inspector:api-debug"],
                prompt: "请帮我分析接口的请求头、入参、状态码与响应体，定位联调失败或字段不匹配的根因并给出修复方案。\n$ARGUMENTS",
              },
            ],
          },
        },
        null,
        2,
      ),
    },
  },
  {
    id: "open.sql-helper",
    name: "SQL 建模与查询优化",
    version: "1.0.0",
    publisher: "Open Community",
    description: "辅助设计数据库表结构、编写复杂聚合查询并分析索引与慢查询瓶颈。",
    files: {
      "nibi-go.plugin.json": JSON.stringify(
        {
          schemaVersion: 1,
          id: "open.sql-helper",
          name: "SQL 建模与查询优化",
          version: "1.0.0",
          description: "辅助设计数据库表结构、编写复杂聚合查询并分析索引与慢查询瓶颈。",
          minApp: "0.1.0",
          accent: "amber",
          caps: ["view.v1", "slots.v1", "effects.v1"],
          skills: [
            {
              id: "sql-tuning",
              name: "SQL 建模与调优",
              description: "数据库表结构设计与慢查询索引优化。",
              body: "# SQL 建模与查询优化\n\n输出 SQL 时明确方言（PostgreSQL / MySQL / SQLite），优先使用联合索引覆盖高频过滤列，避免隐式类型转换与全表扫描。",
            },
          ],
          contributes: {
            "composer.actions": [
              {
                id: "optimize-sql",
                title: "SQL 优化",
                icon: "terminal",
                token: { kind: "command", value: "open-sql-optimize" },
                skills: ["open.sql-helper:sql-tuning"],
                prompt: "请审阅以下 SQL 语句或表结构，分析索引命中情况与执行代价，并给出优化后的 SQL 与索引建议。\n$ARGUMENTS",
              },
            ],
          },
        },
        null,
        2,
      ),
    },
  },
  {
    id: "open.test-architect",
    name: "单元测试与边界用例生成",
    version: "1.0.0",
    publisher: "Open Community",
    description: "针对核心业务函数自动推导正常路径、边界条件与异常分支测试，提升代码覆盖率。",
    files: {
      "nibi-go.plugin.json": JSON.stringify(
        {
          schemaVersion: 1,
          id: "open.test-architect",
          name: "单元测试与边界用例生成",
          version: "1.0.0",
          description: "针对核心业务函数自动推导正常路径、边界条件与异常分支测试。",
          minApp: "0.1.0",
          accent: "ok",
          caps: ["view.v1", "slots.v1", "effects.v1"],
          skills: [
            {
              id: "unit-test-gen",
              name: "边界用例设计",
              description: "推导正常路径、极值边界与异常分支单元测试。",
              body: "# 单元测试与边界用例设计\n\n遵循 Arrange-Act-Assert 结构，聚焦真实业务不变量与边界输入，不写毫无断言的形式化测试。",
            },
          ],
          contributes: {
            "composer.actions": [
              {
                id: "gen-tests",
                title: "生成单测",
                icon: "check",
                token: { kind: "command", value: "open-test-gen" },
                skills: ["open.test-architect:unit-test-gen"],
                prompt: "请为当前模块设计覆盖正常路径、空值/极值边界与异常分支的单元测试用例并运行验证。\n$ARGUMENTS",
              },
            ],
          },
        },
        null,
        2,
      ),
    },
  },
];

function describeFailure(kind: string, detail: string): string {
  switch (kind) {
    case "fetch":
      return `拉取失败：${detail}`;
    case "verify":
      return `验签失败（${detail}）——已拒绝这份索引`;
    case "rollback":
      return `已拒绝回滚：${detail}`;
    case "pins":
      return `插件版本不变量冲突：${detail}`;
    default:
      return detail;
  }
}

function StatusPill({ bg, color, label }: { bg: string; color: string; label: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function formatFetchedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * 市场插件卡片：不显示任何静态「付费 / 会员」标签。
 * 未安装统一显示「未安装」与「安装」按钮；点击「安装」时按需触发登录或内嵌授权。
 */
function MarketRow({
  entry,
  installedVersion,
  busy,
  onInstall,
  onUninstall,
  onCancel,
}: {
  entry: MarketPluginEntry;
  installedVersion: string | null;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onCancel: () => void;
}) {
  const t = useNibiTheme();
  const hasUpdate =
    installedVersion !== null && comparePluginVersions(entry.version, installedVersion) > 0;
  const action = installedVersion === null ? "安装" : hasUpdate ? "更新" : "重新安装";
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleWrap}>
          <Text style={[styles.name, { color: t.ink }]}>{entry.name}</Text>
          <Text style={[styles.meta, { color: t.inkFaint }]}>
            v{entry.version}
            {entry.publisher ? ` · ${entry.publisher}` : ""}
          </Text>
        </View>
        {installedVersion === null ? (
          <StatusPill bg={t.surfaceSoft} color={t.inkFaint} label="未安装" />
        ) : hasUpdate ? (
          <StatusPill bg={t.amberSoft} color={t.amber} label="可更新" />
        ) : (
          <StatusPill bg={t.okSoft} color={t.ok} label={`已安装 v${installedVersion}`} />
        )}
      </View>

      {entry.description ? (
        <Text style={[styles.description, { color: t.inkSub }]}>{entry.description}</Text>
      ) : null}

      <View style={styles.actions}>
        <PillButton
          label={action}
          variant="primary"
          disabled={busy}
          onPress={onInstall}
          accessibilityLabel={`${action} ${entry.name}`}
          style={styles.primaryButton}
        />
        {busy ? (
          <PillButton
            label="取消"
            variant="secondary"
            onPress={onCancel}
            accessibilityLabel={`取消安装 ${entry.name}`}
          />
        ) : null}
        {installedVersion !== null && !busy ? (
          <PillButton
            label="卸载"
            variant="danger"
            disabled={busy}
            onPress={onUninstall}
            accessibilityLabel={`卸载 ${entry.name}`}
          />
        ) : null}
      </View>
    </View>
  );
}

export default function MarketScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const plugins = usePlugins();
  const { session, snapshot: sessionSnapshot } = useSession();

  const [tab, setTab] = useState<MarketTab>("nibi");
  const [region, setRegion] = useState<MarketRegion>(currentMarketRegion());
  const [snapshot, setSnapshot] = useState<MarketSnapshotFile | null>(null);
  const [personalSources, setPersonalSources] = useState<PersonalPluginSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, string | null>>({});
  const [corruptSnapshot, setCorruptSnapshot] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);

  // 按需登录 / 内嵌 WebView 授权弹窗状态（仅在点击需授权插件的「安装」时触发）
  const [loginPromptEntry, setLoginPromptEntry] = useState<MarketPluginEntry | null>(null);
  const [membershipEntry, setMembershipEntry] = useState<MarketPluginEntry | null>(null);

  // 「个人」子页添加源 Sheet 状态
  const [addPersonalOpen, setAddPersonalOpen] = useState(false);
  const [personalNameInput, setPersonalNameInput] = useState("");
  const [personalUrlInput, setPersonalUrlInput] = useState("");
  const [personalRiskAccepted, setPersonalRiskAccepted] = useState(false);
  const [addingPersonal, setAddingPersonal] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const refreshInstalledVersions = useCallback((entries: MarketPluginEntry[]) => {
    const next: Record<string, string | null> = {};
    for (const entry of entries) {
      next[entry.id] = readInstalledManifest(entry.id)?.version ?? null;
    }
    for (const item of CURATED_PUBLIC_PLUGINS) {
      next[item.id] = readInstalledManifest(item.id)?.version ?? null;
    }
    setVersions(next);
  }, []);

  const loadLocal = useCallback(async () => {
    await ensureLicenseLoaded();
    const savedRegion = await loadMarketRegion();
    setRegion(savedRegion);
    const savedPersonal = await loadPersonalSources();
    setPersonalSources(savedPersonal);
    const { snapshot: local, corrupt } = await readMarketSnapshot();
    setCorruptSnapshot(corrupt);
    setSnapshot(local);
    refreshInstalledVersions(local?.index.plugins ?? []);
    setLoading(false);
    return { local, savedRegion };
  }, [refreshInstalledVersions]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadLocal().then(({ local, savedRegion }) => {
        if (!alive) return;
        if (local === null) void doRefresh(true, savedRegion);
      });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadLocal]),
  );

  async function doRefresh(quiet = false, targetRegion?: MarketRegion) {
    if (refreshing) return;
    const activeRegion = targetRegion ?? region;
    setRefreshing(true);
    if (!quiet) setMessage(null);
    try {
      const { result, snapshot: fresh } = await refreshMarket(activeRegion);
      if (!result.ok) {
        setMessage(describeFailure(result.kind, "detail" in result ? (result.detail ?? "") : ""));
        return;
      }
      if (fresh) {
        setSnapshot(fresh);
        refreshInstalledVersions(fresh.index.plugins);
        setMessage(
          result.kind === "unchanged"
            ? `已同步（${marketRegionLabel(activeRegion)}，最新索引）`
            : `已从${marketRegionLabel(activeRegion)}更新索引`,
        );
      } else {
        setMessage(`已同步（${marketRegionLabel(activeRegion)}，已是最新）`);
      }
    } catch (error) {
      setMessage(`刷新失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleRegion() {
    const nextRegion: MarketRegion = region === "cn" ? "global" : "cn";
    setRegion(nextRegion);
    await saveMarketRegion(nextRegion);
    setMessage(
      nextRegion === "cn"
        ? "已切换为国内源（优先 jsDelivr / npmmirror 镜像）"
        : "已切换为国外源（优先 GitHub Raw / npmjs 官方源）",
    );
    void doRefresh(true, nextRegion);
  }

  async function performMarketInstall(entry: MarketPluginEntry) {
    if (busyId) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusyId(entry.id);
    setProgress({ loaded: 0, total: entry.package.size });
    setMessage(`正在通过${marketRegionLabel(region)}下载并校验 ${entry.name} v${entry.version}…`);
    try {
      const outcome = await installMarketPlugin(entry, {
        region,
        signal: controller.signal,
        onProgress: (loaded, total) => setProgress({ loaded, total: total ?? entry.package.size }),
      });
      if (!outcome.ok) {
        setMessage(
          `${entry.name} 安装失败：${outcome.reason}${outcome.reason === "已取消" ? "" : "（可重试）"}`,
        );
        return;
      }
      setVersions((current) => ({ ...current, [entry.id]: outcome.manifest.version }));
      await plugins.reload();
      setMessage(`${entry.name} v${outcome.manifest.version} 已安装`);
    } finally {
      abortRef.current = null;
      setBusyId(null);
      setProgress(null);
    }
  }

  /**
   * 点击「安装」时的统一入口：
   * - 普通插件直接下载安装；
   * - 需要账号授权的插件（entry.paid === true）在点击「安装」时才检查登录态与本机授权：
   *   1) 未登录 → 弹窗引导登录 NIBI 账号；
   *   2) 已登录但未获权 → 先在线同步一次授权，仍未获权则打开应用内嵌 handoff WebView。
   */
  async function handleInstallPress(entry: MarketPluginEntry) {
    if (busyId) return;
    if (!entry.paid) {
      await performMarketInstall(entry);
      return;
    }

    if (!sessionSnapshot.loggedIn) {
      setLoginPromptEntry(entry);
      return;
    }

    await ensureLicenseLoaded();
    let decision = pluginLicenseDecision(entry.id);
    if (!decision.allowed) {
      setMessage("正在核验账号授权状态…");
      await syncLicense().catch(() => null);
      decision = pluginLicenseDecision(entry.id);
    }
    if (decision.allowed) {
      await performMarketInstall(entry);
      return;
    }

    setMessage(null);
    setMembershipEntry(entry);
  }

  async function handleConfirmLoginAndInstall() {
    const targetEntry = loginPromptEntry;
    setLoginPromptEntry(null);
    if (!targetEntry) return;
    try {
      await session.login();
      const current = session.getSnapshot();
      if (!current.loggedIn) {
        setMessage(current.error?.message ?? "登录未完成，请重试");
        return;
      }
      await syncLicense().catch(() => null);
      const decision = pluginLicenseDecision(targetEntry.id);
      if (decision.allowed) {
        await performMarketInstall(targetEntry);
      } else {
        setMembershipEntry(targetEntry);
      }
    } catch (error) {
      setMessage(`登录失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function cancelInstall() {
    abortRef.current?.abort();
  }

  async function uninstall(id: string, name: string) {
    const removed = await uninstallMarketPlugin(id);
    setVersions((current) => ({ ...current, [id]: null }));
    await plugins.reload();
    setMessage(removed ? `已卸载 ${name}` : `${name} 未安装`);
  }

  async function installCuratedPublic(item: CuratedPublicPlugin) {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const archiveInput: Record<string, Uint8Array> = {};
      for (const [relPath, content] of Object.entries(item.files)) {
        archiveInput[relPath] = strToU8(content);
      }
      const zipped = zipSync(archiveInput);
      const outcome = await installPluginArchiveBytes(zipped, {
        expectedId: item.id,
        expectedVersion: item.version,
      });
      if (!outcome.ok) {
        setMessage(`${item.name} 安装失败：${outcome.reason}`);
        return;
      }
      setVersions((current) => ({ ...current, [item.id]: outcome.manifest.version }));
      await plugins.reload();
      setMessage(`${item.name} v${outcome.manifest.version} 已安装并启用`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddPersonalUrl() {
    const url = personalUrlInput.trim();
    if (!url || !personalRiskAccepted || addingPersonal) return;
    if (!/^https?:\/\//i.test(url)) {
      setMessage("请输入以 https:// 或 http:// 开头的插件包 (.zip) 地址");
      return;
    }
    setAddingPersonal(true);
    setMessage(`正在通过${marketRegionLabel(region)}拉取个人插件包…`);
    try {
      const outcome = await installPersonalUrlPlugin(url, { region });
      if (!outcome.ok) {
        setMessage(`添加失败：${outcome.reason}`);
        return;
      }
      const sourceEntry: PersonalPluginSource = {
        id: `src-${Date.now()}`,
        name: personalNameInput.trim() || outcome.manifest.name,
        url,
        addedAt: new Date().toISOString(),
        installedPluginId: outcome.manifest.id,
      };
      const next = [
        sourceEntry,
        ...personalSources.filter(
          (item) => item.url !== url && item.installedPluginId !== outcome.manifest.id,
        ),
      ];
      setPersonalSources(next);
      await savePersonalSources(next);
      setVersions((current) => ({ ...current, [outcome.manifest.id]: outcome.manifest.version }));
      await plugins.reload();
      setAddPersonalOpen(false);
      setPersonalNameInput("");
      setPersonalUrlInput("");
      setPersonalRiskAccepted(false);
      setMessage(`已从个人源安装 ${outcome.manifest.name} v${outcome.manifest.version}`);
    } finally {
      setAddingPersonal(false);
    }
  }

  async function handleImportLocalZip() {
    if (busyId) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      setBusyId("local-zip");
      setMessage(`正在校验本地插件包 ${asset.name}…`);
      const file = new File(asset.uri);
      const bytes = await file.bytes();
      const outcome = await installPluginArchiveBytes(bytes);
      if (!outcome.ok) {
        setMessage(`本地插件包导入失败：${outcome.reason}`);
        return;
      }
      setVersions((current) => ({ ...current, [outcome.manifest.id]: outcome.manifest.version }));
      await plugins.reload();
      setMessage(`已导入并安装 ${outcome.manifest.name} v${outcome.manifest.version}`);
    } catch (error) {
      setMessage(`读取本地插件包失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemovePersonalSource(source: PersonalPluginSource) {
    const next = personalSources.filter((item) => item.id !== source.id);
    setPersonalSources(next);
    await savePersonalSources(next);
    if (source.installedPluginId) {
      await uninstallMarketPlugin(source.installedPluginId);
      setVersions((current) => ({ ...current, [source.installedPluginId!]: null }));
      await plugins.reload();
    }
    setMessage(`已移除个人插件源「${source.name}」`);
  }

  const allRemoteEntries = useMemo(() => visibleMarketEntries(snapshot), [snapshot]);
  const nibiRemoteEntries = useMemo(
    () => allRemoteEntries.filter((entry) => isOfficialNibiMarketEntry(entry)),
    [allRemoteEntries],
  );
  const publicRemoteEntries = useMemo(
    () => allRemoteEntries.filter((entry) => !isOfficialNibiMarketEntry(entry)),
    [allRemoteEntries],
  );

  // 本地已安装的个人/第三方插件（既不是内置插件，也不在公开策展和远端公开索引中）
  const localPersonalPlugins = useMemo(() => {
    const curatedIds = new Set(CURATED_PUBLIC_PLUGINS.map((item) => item.id));
    const remoteIds = new Set(allRemoteEntries.map((item) => item.id));
    return plugins.plugins.filter(
      (plugin) =>
        !plugin.bundled &&
        !curatedIds.has(plugin.parsed.manifest.id) &&
        !remoteIds.has(plugin.parsed.manifest.id),
    );
  }, [plugins.plugins, allRemoteEntries]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[t.glowTop, t.bgGradient[0], t.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader
        title="插件市场"
        onBack={() => router.back()}
        right={
          <View style={styles.headerRightRow}>
            <PressableScale
              onPress={() => void toggleRegion()}
              disabled={refreshing}
              accessibilityRole="button"
              accessibilityLabel={`切换镜像源，当前为${marketRegionLabel(region)}`}
              hitSlop={6}
              style={[
                styles.regionButton,
                { backgroundColor: t.glass, borderColor: t.glassBorder },
                refreshing ? styles.busy : null,
              ]}
            >
              <Icon name="globe" size={14} color={t.brand} />
              <Text style={[styles.regionButtonText, { color: t.ink }]}>
                {marketRegionLabel(region)}
              </Text>
            </PressableScale>

            <PressableScale
              onPress={() => void doRefresh()}
              disabled={refreshing}
              accessibilityRole="button"
              accessibilityLabel="刷新市场索引"
              hitSlop={8}
              style={[
                styles.headButton,
                { backgroundColor: t.glass, borderColor: t.glassBorder },
                refreshing ? styles.busy : null,
              ]}
            >
              {refreshing ? (
                <ActivityIndicator color={t.brand} size="small" />
              ) : (
                <Icon name="refresh" size={16} color={t.ink} />
              )}
            </PressableScale>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}
      >
        <AppearIn delay={staggerDelay(0, 28, 200)}>
          <SegmentedControl
            options={MARKET_TABS}
            value={tab}
            onChange={setTab}
          />
        </AppearIn>

        <AppearIn delay={staggerDelay(1, 28, 200)}>
          <View style={[styles.mirrorBanner, { backgroundColor: t.card, borderColor: t.hairline }]}>
            <View style={styles.mirrorBannerTextWrap}>
              <Text style={[styles.mirrorBannerTitle, { color: t.ink }]}>
                当前镜像：{marketRegionLabel(region)}
              </Text>
              <Text style={[styles.mirrorBannerSub, { color: t.inkFaint }]}>
                {region === "cn"
                  ? "优先走 jsDelivr / Fastly 公共镜像与 npmmirror 国内源，无需消耗自有 CDN"
                  : "优先走 GitHub Raw 与 registry.npmjs.org 全球官方源，jsDelivr 自动兜底"}
              </Text>
            </View>
            <PillButton
              label={region === "cn" ? "切国外源" : "切国内源"}
              variant="secondary"
              buttonSize="sm"
              onPress={() => void toggleRegion()}
            />
          </View>
        </AppearIn>

        {corruptSnapshot ? (
          <View style={[styles.message, { backgroundColor: t.amberSoft, borderColor: t.hairline }]}>
            <Text style={[styles.messageText, { color: t.amber }]}>
              本地市场快照损坏，已忽略；刷新会重新建立快照。
            </Text>
          </View>
        ) : null}

        {message ? (
          <View style={[styles.message, { backgroundColor: t.panel, borderColor: t.hairline }]}>
            <Text style={[styles.messageText, { color: t.inkSub }]}>{message}</Text>
          </View>
        ) : null}

        {busyId && progress ? (
          <View style={styles.progressWrap}>
            <View style={[styles.progressTrack, { backgroundColor: t.surfaceSoft }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: t.brand,
                    width: `${Math.max(
                      4,
                      Math.min(100, Math.round((progress.loaded * 100) / (progress.total || 1))),
                    )}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: t.inkFaint }]}>
              {Math.min(100, Math.round((progress.loaded * 100) / (progress.total || 1)))}%
            </Text>
          </View>
        ) : null}

        {tab === "nibi" ? (
          <>
            <AppearIn delay={staggerDelay(2, 28, 200)}>
              <SectionCard label="NIBI-GO 官方套件（本机就绪）">
                {BUNDLED_PLUGINS.map((bundled, idx) => {
                  const installed = plugins.plugins.find((item) => item.dir === bundled.dir);
                  const manifest = installed?.parsed.manifest;
                  const enabled = installed?.enabled ?? true;
                  return (
                    <Fragment key={bundled.dir}>
                      {idx > 0 ? <Divider /> : null}
                      <Row
                        icon="sparkles"
                        tone="brand"
                        title={manifest?.name ?? bundled.dir}
                        detail={
                          manifest?.description ??
                          "NIBI-GO 官方内置套件，支持本地 MCP 工具与快捷技能"
                        }
                        right={
                          <Switch
                            value={enabled}
                            onValueChange={(next) => void plugins.setEnabled(bundled.dir, next)}
                            trackColor={{ false: t.surfaceSoft, true: t.brand }}
                            thumbColor="#FFFFFF"
                          />
                        }
                      />
                    </Fragment>
                  );
                })}
              </SectionCard>
            </AppearIn>

            {nibiRemoteEntries.length > 0 ? (
              <AppearIn delay={staggerDelay(3, 28, 200)}>
                <View style={styles.sectionStack}>
                  <Text style={[styles.sectionHeading, { color: t.inkFaint }]}>
                    NIBI 官方扩展包
                  </Text>
                  {nibiRemoteEntries.map((entry) => (
                    <MarketRow
                      key={entry.id}
                      entry={entry}
                      installedVersion={versions[entry.id] ?? null}
                      busy={busyId === entry.id}
                      onInstall={() => void handleInstallPress(entry)}
                      onUninstall={() => void uninstall(entry.id, entry.name)}
                      onCancel={cancelInstall}
                    />
                  ))}
                </View>
              </AppearIn>
            ) : null}
          </>
        ) : null}

        {tab === "public" ? (
          <>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={t.brand} />
                <Text style={[styles.hint, { color: t.inkFaint }]}>读取公开插件列表…</Text>
              </View>
            ) : (
              <View style={styles.sectionStack}>
                {CURATED_PUBLIC_PLUGINS.map((item, idx) => {
                  const installedVer = versions[item.id] ?? null;
                  const isBusy = busyId === item.id;
                  return (
                    <AppearIn key={item.id} delay={staggerDelay(idx + 2, 28, 200)}>
                      <View
                        style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}
                      >
                        <View style={styles.cardHead}>
                          <View style={styles.cardTitleWrap}>
                            <Text style={[styles.name, { color: t.ink }]}>{item.name}</Text>
                            <Text style={[styles.meta, { color: t.inkFaint }]}>
                              v{item.version} · {item.publisher}
                            </Text>
                          </View>
                          {installedVer === null ? (
                            <StatusPill bg={t.surfaceSoft} color={t.inkFaint} label="未安装" />
                          ) : (
                            <StatusPill
                              bg={t.okSoft}
                              color={t.ok}
                              label={`已安装 v${installedVer}`}
                            />
                          )}
                        </View>
                        <Text style={[styles.description, { color: t.inkSub }]}>
                          {item.description}
                        </Text>
                        <View style={styles.actions}>
                          <PillButton
                            label={installedVer === null ? "安装" : "重新安装"}
                            variant="primary"
                            disabled={isBusy}
                            onPress={() => void installCuratedPublic(item)}
                            style={styles.primaryButton}
                          />
                          {installedVer !== null && !isBusy ? (
                            <PillButton
                              label="卸载"
                              variant="danger"
                              onPress={() => void uninstall(item.id, item.name)}
                            />
                          ) : null}
                        </View>
                      </View>
                    </AppearIn>
                  );
                })}

                {publicRemoteEntries.map((entry, idx) => (
                  <AppearIn
                    key={entry.id}
                    delay={staggerDelay(CURATED_PUBLIC_PLUGINS.length + idx + 2, 28, 200)}
                  >
                    <MarketRow
                      entry={entry}
                      installedVersion={versions[entry.id] ?? null}
                      busy={busyId === entry.id}
                      onInstall={() => void handleInstallPress(entry)}
                      onUninstall={() => void uninstall(entry.id, entry.name)}
                      onCancel={cancelInstall}
                    />
                  </AppearIn>
                ))}
              </View>
            )}
          </>
        ) : null}

        {tab === "personal" ? (
          <AppearIn delay={staggerDelay(2, 28, 200)}>
            <View style={styles.sectionStack}>
              <SectionCard label="添加个人插件">
                <Row
                  icon="globe"
                  tone="brand"
                  title="从链接或镜像源安装 (.zip)"
                  detail="支持 GitHub Raw、jsDelivr、npmmirror 或任意 HTTPS 插件包直链"
                  onPress={() => setAddPersonalOpen(true)}
                />
                <Divider />
                <Row
                  icon="folder"
                  tone="steel"
                  title="从手机本地导入插件包 (.zip)"
                  detail="选择本机含 nibi-go.plugin.json 清单的 .zip 插件压缩包安装"
                  onPress={() => void handleImportLocalZip()}
                />
              </SectionCard>

              {personalSources.length > 0 ? (
                <SectionCard label="已添加的个人源">
                  {personalSources.map((src, idx) => {
                    const installedVer = src.installedPluginId
                      ? (versions[src.installedPluginId] ??
                        readInstalledManifest(src.installedPluginId)?.version ??
                        null)
                      : null;
                    return (
                      <Fragment key={src.id}>
                        {idx > 0 ? <Divider /> : null}
                        <Row
                          icon="puzzle"
                          tone="plain"
                          title={src.name}
                          detail={src.url}
                          right={
                            <View style={styles.rowRight}>
                              {installedVer ? (
                                <StatusPill
                                  bg={t.okSoft}
                                  color={t.ok}
                                  label={`v${installedVer}`}
                                />
                              ) : null}
                              <PillButton
                                label="移除"
                                variant="danger"
                                buttonSize="sm"
                                onPress={() => void handleRemovePersonalSource(src)}
                              />
                            </View>
                          }
                        />
                      </Fragment>
                    );
                  })}
                </SectionCard>
              ) : null}

              {localPersonalPlugins.length > 0 ? (
                <SectionCard label="本机个人插件">
                  {localPersonalPlugins.map((plugin, idx) => (
                    <Fragment key={plugin.dir}>
                      {idx > 0 ? <Divider /> : null}
                      <Row
                        icon="puzzle"
                        tone="plain"
                        title={plugin.parsed.manifest.name}
                        detail={`${plugin.parsed.manifest.id} · v${plugin.parsed.manifest.version}`}
                        right={
                          <View style={styles.rowRight}>
                            <StatusPill bg={t.okSoft} color={t.ok} label="已安装" />
                            <PillButton
                              label="卸载"
                              variant="danger"
                              buttonSize="sm"
                              onPress={() =>
                                void uninstall(plugin.dir, plugin.parsed.manifest.name)
                              }
                            />
                          </View>
                        }
                      />
                    </Fragment>
                  ))}
                </SectionCard>
              ) : (
                <View style={[styles.empty, { borderColor: t.hairline, backgroundColor: t.card }]}>
                  <Text style={[styles.emptyTitle, { color: t.inkSub }]}>
                    还没有添加个人插件
                  </Text>
                  <Text style={[styles.hint, { color: t.inkFaint }]}>
                    你可以粘贴 GitHub / jsDelivr / npmmirror 上的插件包直链，或直接从手机文件选择器导入本地 .zip 插件包。
                  </Text>
                </View>
              )}
            </View>
          </AppearIn>
        ) : null}

        {snapshot ? (
          <Text style={[styles.footnote, { color: t.inkGhost }]}>
            索引同步于 {formatFetchedAt(snapshot.fetchedAt)} · {marketRegionLabel(region)}
          </Text>
        ) : null}
      </ScrollView>

      {/* 添加个人插件源 Sheet */}
      <Sheet
        visible={addPersonalOpen}
        onClose={() => setAddPersonalOpen(false)}
        title="添加个人插件包地址"
      >
        <View style={styles.sheetForm}>
          <Text style={[styles.hint, { color: t.inkSub }]}>
            支持填写 GitHub Raw、jsDelivr、npmmirror 或个人服务器上的插件包（.zip）HTTPS 地址，下载时将自动按当前所选「{marketRegionLabel(region)}」加速。
          </Text>
          <TextInput
            value={personalNameInput}
            onChangeText={setPersonalNameInput}
            placeholder="备注名称（可选，留空自动取插件清单名）"
            placeholderTextColor={t.inkGhost}
            style={[
              styles.input,
              { color: t.ink, borderColor: t.hairline, backgroundColor: t.surfaceSoft },
            ]}
          />
          <TextInput
            value={personalUrlInput}
            onChangeText={setPersonalUrlInput}
            placeholder="https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/plugin.zip"
            placeholderTextColor={t.inkGhost}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[
              styles.input,
              { color: t.ink, borderColor: t.hairline, backgroundColor: t.surfaceSoft },
            ]}
          />
          <PressableScale
            onPress={() => setPersonalRiskAccepted((prev) => !prev)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: personalRiskAccepted }}
            style={styles.checkboxRow}
          >
            <View
              style={[
                styles.checkboxBox,
                {
                  borderColor: personalRiskAccepted ? t.brand : t.inkFaint,
                  backgroundColor: personalRiskAccepted ? t.brand : "transparent",
                },
              ]}
            >
              {personalRiskAccepted ? <Icon name="check" size={12} color="#FFFFFF" /> : null}
            </View>
            <Text style={[styles.checkboxLabel, { color: t.inkSub }]}>
              我信任该插件来源，并知晓自定义插件将在本机沙箱环境中运行。
            </Text>
          </PressableScale>
          <View style={styles.sheetActions}>
            <PillButton
              label="取消"
              variant="secondary"
              onPress={() => setAddPersonalOpen(false)}
            />
            <PillButton
              label={addingPersonal ? "正在安装…" : "下载并安装"}
              variant="primary"
              disabled={!personalUrlInput.trim() || !personalRiskAccepted || addingPersonal}
              onPress={() => void handleAddPersonalUrl()}
            />
          </View>
        </View>
      </Sheet>

      {/* 按需登录确认框：仅在点击需账号授权插件的「安装」且未登录时弹出 */}
      <ConfirmDialog
        visible={loginPromptEntry !== null}
        title="需要登录 NIBI 账号"
        message={
          loginPromptEntry
            ? `安装「${loginPromptEntry.name}」需要先登录你的 NIBI 账号以核验可用权限。`
            : ""
        }
        confirmLabel="立即登录"
        cancelLabel="取消"
        onConfirm={() => void handleConfirmLoginAndInstall()}
        onCancel={() => setLoginPromptEntry(null)}
      />

      {/* 按需内嵌账号授权 WebView：仅在点击「安装」且当前账号尚未获权时弹出 */}
      <MembershipSheet
        visible={membershipEntry !== null}
        pluginName={membershipEntry?.name}
        onClose={() => setMembershipEntry(null)}
        onLoginRequested={async () => {
          await session.login();
        }}
        onAuthorized={() => {
          const target = membershipEntry;
          setMembershipEntry(null);
          if (target) {
            void performMarketInstall(target);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
  },
  regionButton: {
    height: size.button,
    paddingHorizontal: space(2.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
  },
  regionButtonText: {
    ...text("micro"),
    fontWeight: "700",
  },
  headButton: {
    width: size.button,
    height: size.button,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  busy: { opacity: 0.6 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(3) },
  mirrorBanner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2.5),
  },
  mirrorBannerTextWrap: {
    flex: 1,
    gap: space(0.5),
  },
  mirrorBannerTitle: {
    ...text("small"),
    fontWeight: "700",
  },
  mirrorBannerSub: {
    ...text("micro"),
  },
  sectionStack: {
    gap: space(2.5),
  },
  sectionHeading: {
    ...text("micro"),
    fontWeight: "700",
    paddingHorizontal: space(1),
  },
  hint: { ...text("small") },
  progressWrap: { flexDirection: "row", alignItems: "center", gap: space(2) },
  progressTrack: { flex: 1, height: 6, borderRadius: radius.chip, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: radius.chip },
  progressText: { ...text("micro"), minWidth: space(8), textAlign: "right" },
  message: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: space(3) },
  messageText: { ...text("small") },
  loading: { alignItems: "center", gap: space(2), paddingVertical: space(6) },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(4),
    gap: space(1.5),
  },
  emptyTitle: { ...text("body"), fontWeight: "700" },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
    gap: space(2),
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: space(2) },
  cardTitleWrap: { flex: 1, gap: space(0.5) },
  name: { ...text("bodyLg"), fontWeight: "700" },
  meta: { ...text("micro"), marginTop: space(0.5) },
  description: { ...text("small") },
  pill: { borderRadius: radius.chip, paddingHorizontal: space(2), paddingVertical: space(0.75) },
  pillText: { ...text("micro"), fontWeight: "700" },
  actions: { flexDirection: "row", gap: space(2), flexWrap: "wrap" },
  primaryButton: { minWidth: space(24) },
  rowRight: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  footnote: { ...text("micro") },
  sheetForm: {
    gap: space(2.5),
    paddingHorizontal: space(4),
    paddingBottom: space(3),
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    ...text("small"),
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2),
    paddingVertical: space(1),
  },
  checkboxBox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxLabel: {
    ...text("small"),
    flex: 1,
  },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space(2),
    marginTop: space(1),
  },
});
