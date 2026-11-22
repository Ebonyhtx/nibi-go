// 插件市场（NIBI-GO 手机独立市场，与桌面端 CDN/索引彻底隔离）：
// 分为「NIBI / 公开 / 个人」三个子页，顶部支持一键切换「国内源 / 国外源」。
//
// - NIBI：本机随包内置的手机轻量官方套件 + 远端手机市场官方扩展；
// - 公开：实时搜索 npm 公共源（按地区走 npmmirror / npmjs）+ nibi-go-market 签名目录与开源推荐；
// - 个人：直接输入 npm 包名安装纯 JS MCP、从直链安装标准 ZIP（.nibi-plugin/.claude-plugin/.codex-plugin/skills）或本地导入。
//
// 界面静态零「付费 / 会员」字样：所有未安装插件统一展示「安装」；
// 仅在点击「安装」且该插件需要账号授权时，才按需校验登录态与授权，未获权时弹出应用内嵌 handoff WebView。

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { strToU8, zipSync } from "fflate";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Linking,
  Pressable,
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
  installPersonalNpmPlugin,
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
import {
  npmPluginIdFor,
  PUBLIC_BROWSE_CHANNELS,
  searchNpmPackages,
  type NpmSearchHit,
  type PublicBrowseChannel,
  type PublicBrowseChannelId,
} from "../plugins/npmRegistry";
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
          accent: "sub",
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
          accent: "warn",
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

interface FeaturedNpmMcp {
  id: string;
  packageName: string;
  name: string;
  publisher: string;
  category: string;
  envHint: string;
  description: string;
  keywords: readonly string[];
  homepage?: string;
}

/**
 * 精选纯 JS 开源 npm MCP（均已验证无原生编译脚本、Android 随包 Node 可直接运行；
 * 若远端签名索引已收录同 id 条目，则自动去重、以签名索引为准）。
 */
const FEATURED_NPM_MCPS: readonly FeaturedNpmMcp[] = [
  {
    id: npmPluginIdFor("@modelcontextprotocol/server-sequential-thinking"),
    packageName: "@modelcontextprotocol/server-sequential-thinking",
    name: "顺序思考（Sequential Thinking）",
    publisher: "Model Context Protocol",
    category: "推理规划",
    envHint: "免密钥 · 装完即用",
    description: "官方纯 JS 分步推理 MCP 服务器，辅助复杂问题的多步拆解、修订与分支验证。",
    keywords: ["mcp", "thinking", "reasoning", "official"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: npmPluginIdFor("@modelcontextprotocol/server-memory"),
    packageName: "@modelcontextprotocol/server-memory",
    name: "知识图谱记忆（Memory）",
    publisher: "Model Context Protocol",
    category: "知识记忆",
    envHint: "免密钥 · 装完即用",
    description: "官方纯 JS 实体与关系知识图谱 MCP，支持在本地持久记录与检索结构化记忆。",
    keywords: ["mcp", "memory", "knowledge-graph", "official"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: npmPluginIdFor("amap-mcp-server"),
    packageName: "amap-mcp-server",
    name: "高德地图 MCP",
    publisher: "AMap 社区",
    category: "地图出行",
    envHint: "需配置 AMAP_KEY",
    description: "提供路径规划、地理编码、POI 搜索、周边检索、实时天气与路线导航能力。",
    keywords: ["mcp", "amap", "map", "weather", "navigation"],
    homepage: "https://www.npmjs.com/package/amap-mcp-server",
  },
  {
    id: npmPluginIdFor("bing-cn-mcp"),
    packageName: "bing-cn-mcp",
    name: "必应中文搜索",
    publisher: "Open Community",
    category: "联网搜索",
    envHint: "免密钥 · 装完即用",
    description: "必应中文实时网页搜索 MCP 服务器，支持快速检索中文资讯与网页摘要。",
    keywords: ["mcp", "bing", "search", "web"],
    homepage: "https://www.npmjs.com/package/bing-cn-mcp",
  },
  {
    id: npmPluginIdFor("mcp-fetch-server"),
    packageName: "mcp-fetch-server",
    name: "网页抓取（Fetch）",
    publisher: "Open Community",
    category: "网页工具",
    envHint: "免密钥 · 装完即用",
    description: "将任意公开网页抓取并转换为干净的 Markdown / 纯文本，便于交给助手阅读总结。",
    keywords: ["mcp", "fetch", "web", "markdown"],
    homepage: "https://www.npmjs.com/package/mcp-fetch-server",
  },
  {
    id: npmPluginIdFor("open-meteo-mcp-server"),
    packageName: "open-meteo-mcp-server",
    name: "全球天气预报（Open-Meteo）",
    publisher: "Open Community",
    category: "天气生活",
    envHint: "免密钥 · 装完即用",
    description: "基于 Open-Meteo 免费气象接口查询全球城市实时天气、逐小时预报与空气质量。",
    keywords: ["mcp", "weather", "open-meteo", "forecast"],
    homepage: "https://www.npmjs.com/package/open-meteo-mcp-server",
  },
  {
    id: npmPluginIdFor("@upstash/context7-mcp"),
    packageName: "@upstash/context7-mcp",
    name: "Context7 开发文档",
    publisher: "Upstash",
    category: "开发文档",
    envHint: "免密钥即可使用（支持可选 Key）",
    description: "实时拉取最新版主流框架与开源库的官方文档及代码示例，减少模型过时 API 幻觉。",
    keywords: ["mcp", "docs", "context7", "developer"],
    homepage: "https://github.com/upstash/context7",
  },
  {
    id: npmPluginIdFor("howtocook-mcp"),
    packageName: "howtocook-mcp",
    name: "今日吃什么 · 菜谱大全",
    publisher: "Open Community",
    category: "生活实用",
    envHint: "免密钥 · 装完即用",
    description: "内置丰富家常菜谱，支持按食材、口味或人数推荐三餐搭配并给出详细步骤。",
    keywords: ["mcp", "recipe", "cooking", "life"],
    homepage: "https://www.npmjs.com/package/howtocook-mcp",
  },
];

interface BrowseFeedState {
  hits: NpmSearchHit[];
  nextFrom: number;
  total: number;
  hasMore: boolean;
  registry: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadedOnce: boolean;
}

const EMPTY_BROWSE_FEED: BrowseFeedState = {
  hits: [],
  nextFrom: 0,
  total: 0,
  hasMore: false,
  registry: null,
  loading: false,
  loadingMore: false,
  error: null,
  loadedOnce: false,
};

type PublicDetailTarget =
  | { kind: "market"; entry: MarketPluginEntry }
  | { kind: "featured"; item: FeaturedNpmMcp }
  | { kind: "npm"; hit: NpmSearchHit }
  | { kind: "curated"; item: CuratedPublicPlugin };

const BROWSE_PAGE_SIZE = 16;

function safeExternalHttpsUrl(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^git\+/iu, "").replace(/\.git$/iu, "");
  return /^https:\/\/[^\s]+$/iu.test(trimmed) ? trimmed : null;
}

function mergeUniqueNpmHits(
  existing: readonly NpmSearchHit[],
  incoming: readonly NpmSearchHit[],
): NpmSearchHit[] {
  const seen = new Set(existing.map((item) => item.name));
  const merged = [...existing];
  for (const hit of incoming) {
    if (seen.has(hit.name)) continue;
    seen.add(hit.name);
    merged.push(hit);
  }
  return merged;
}

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
  onPressDetail,
}: {
  entry: MarketPluginEntry;
  installedVersion: string | null;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onCancel: () => void;
  onPressDetail?: () => void;
}) {
  const t = useNibiTheme();
  const hasUpdate =
    installedVersion !== null && comparePluginVersions(entry.version, installedVersion) > 0;
  const action = installedVersion === null ? "安装" : hasUpdate ? "更新" : "重新安装";
  const formatTag =
    entry.package.format === "npm"
      ? "npm MCP"
      : entry.kind === "skill"
        ? "技能包"
        : "标准 ZIP";
  const sourceDetail =
    entry.package.format === "npm"
      ? `${entry.package.name} · v${entry.version}`
      : `v${entry.version}${entry.publisher ? ` · ${entry.publisher}` : ""}`;
  const body = (
    <>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleWrap}>
          <View style={styles.titleBadgeRow}>
            <Text style={[styles.name, { color: t.ink }]}>{entry.name}</Text>
            <StatusPill bg={t.brandSoft} color={t.brand} label={formatTag} />
          </View>
          <Text style={[styles.meta, { color: t.inkFaint }]} numberOfLines={1}>
            {sourceDetail}
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
        <Text style={[styles.description, { color: t.inkSub }]} numberOfLines={3}>
          {entry.description}
        </Text>
      ) : null}
    </>
  );
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
      {onPressDetail ? (
        <Pressable
          onPress={onPressDetail}
          accessibilityRole="button"
          accessibilityLabel={`查看 ${entry.name} 详情`}
          style={({ pressed }) => [styles.cardBodyTap, pressed ? { opacity: 0.78 } : null]}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}

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

  // 「个人」子页添加 ZIP 源 Sheet 状态
  const [addPersonalOpen, setAddPersonalOpen] = useState(false);
  const [personalNameInput, setPersonalNameInput] = useState("");
  const [personalUrlInput, setPersonalUrlInput] = useState("");
  const [personalRiskAccepted, setPersonalRiskAccepted] = useState(false);
  const [addingPersonal, setAddingPersonal] = useState(false);

  // 「个人」子页添加 npm MCP Sheet 状态
  const [addNpmOpen, setAddNpmOpen] = useState(false);
  const [personalNpmNameInput, setPersonalNpmNameInput] = useState("");
  const [personalNpmSpecInput, setPersonalNpmSpecInput] = useState("");
  const [personalNpmRiskAccepted, setPersonalNpmRiskAccepted] = useState(false);
  const [addingNpm, setAddingNpm] = useState(false);

  // 「公开」子页：分类浏览 + 实时搜索 npm 公共源状态
  const [browseChannel, setBrowseChannel] = useState<PublicBrowseChannelId>("featured");
  const [browseFeeds, setBrowseFeeds] = useState<Record<string, BrowseFeedState>>({});
  const browseFeedsRef = useRef<Record<string, BrowseFeedState>>({});
  const browseReqSeqRef = useRef<Record<string, number>>({});
  const [publicDetail, setPublicDetail] = useState<PublicDetailTarget | null>(null);

  const [npmQuery, setNpmQuery] = useState("");
  const [npmHits, setNpmHits] = useState<NpmSearchHit[]>([]);
  const [npmNextFrom, setNpmNextFrom] = useState(0);
  const [npmTotal, setNpmTotal] = useState(0);
  const [npmHasMore, setNpmHasMore] = useState(false);
  const [npmSearching, setNpmSearching] = useState(false);
  const [npmLoadingMore, setNpmLoadingMore] = useState(false);
  const [npmSearchRegistry, setNpmSearchRegistry] = useState<string | null>(null);
  const [npmSearchError, setNpmSearchError] = useState<string | null>(null);
  const [npmHasSearched, setNpmHasSearched] = useState(false);
  const [pendingNpmConfirm, setPendingNpmConfirm] = useState<{
    packageName: string;
    version?: string;
    displayName: string;
    description?: string;
    origin: "npm-search" | "personal";
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const refreshInstalledVersions = useCallback((entries: MarketPluginEntry[]) => {
    const next: Record<string, string | null> = {};
    for (const entry of entries) {
      next[entry.id] = readInstalledManifest(entry.id)?.version ?? null;
    }
    for (const item of CURATED_PUBLIC_PLUGINS) {
      next[item.id] = readInstalledManifest(item.id)?.version ?? null;
    }
    for (const item of FEATURED_NPM_MCPS) {
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
    if (entry.package.format === "zip") {
      setProgress({ loaded: 0, total: entry.package.size });
      setMessage(`正在通过${marketRegionLabel(region)}下载并校验 ${entry.name} v${entry.version}…`);
    } else {
      setProgress(null);
      setMessage(
        `正在通过${marketRegionLabel(region)}内置 npm 安装 ${entry.package.name}@${entry.version}…`,
      );
    }
    try {
      const outcome = await installMarketPlugin(entry, {
        region,
        signal: controller.signal,
        onProgress: (loaded, total) => {
          if (entry.package.format === "zip") {
            setProgress({ loaded, total: total ?? entry.package.size });
          }
        },
        onStatus: (statusText) => setMessage(statusText),
      });
      if (!outcome.ok) {
        setMessage(
          `${entry.name} 安装失败：${outcome.reason}${outcome.reason === "已取消" ? "" : "（可重试）"}`,
        );
        return;
      }
      setVersions((current) => ({ ...current, [entry.id]: outcome.manifest.version }));
      await plugins.reload();
      setMessage(`${entry.name} v${outcome.manifest.version} 已安装并启用`);
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

  const activeBrowseChannel: PublicBrowseChannel =
    PUBLIC_BROWSE_CHANNELS.find((item) => item.id === browseChannel) ?? PUBLIC_BROWSE_CHANNELS[0]!;
  const browseCacheKey = `${region}:${browseChannel}`;
  const currentBrowseFeed = browseFeeds[browseCacheKey] ?? EMPTY_BROWSE_FEED;

  const syncVersionsForHits = useCallback((hits: readonly NpmSearchHit[]) => {
    if (hits.length === 0) return;
    setVersions((current) => {
      const next = { ...current };
      for (const hit of hits) {
        const id = npmPluginIdFor(hit.name);
        next[id] = readInstalledManifest(id)?.version ?? null;
      }
      return next;
    });
  }, []);

  const loadBrowseChannel = useCallback(
    async (
      channel: PublicBrowseChannel,
      targetRegion: MarketRegion,
      mode: "initial" | "refresh" | "more",
    ) => {
      if (!channel.query) return;
      const key = `${targetRegion}:${channel.id}`;
      const currentSnapshot = browseFeedsRef.current[key] ?? EMPTY_BROWSE_FEED;
      let fromOffset = 0;
      if (mode === "more") {
        if (currentSnapshot.loading || currentSnapshot.loadingMore || !currentSnapshot.hasMore) {
          return;
        }
        fromOffset = currentSnapshot.nextFrom;
      } else if (mode === "initial" && (currentSnapshot.loading || currentSnapshot.loadedOnce)) {
        return;
      }

      const patchFeed = (updater: (cur: BrowseFeedState) => BrowseFeedState) => {
        setBrowseFeeds((prev) => {
          const base = prev[key] ?? EMPTY_BROWSE_FEED;
          const nextFeed = updater(base);
          const nextMap = { ...prev, [key]: nextFeed };
          browseFeedsRef.current = nextMap;
          return nextMap;
        });
      };

      patchFeed((cur) =>
        mode === "more"
          ? { ...cur, loadingMore: true, error: null }
          : { ...cur, loading: true, error: null },
      );

      const seq = (browseReqSeqRef.current[key] ?? 0) + 1;
      browseReqSeqRef.current[key] = seq;

      const res = await searchNpmPackages(channel.query, targetRegion, {
        size: BROWSE_PAGE_SIZE,
        from: fromOffset,
        filterLibraries: true,
      });

      if (browseReqSeqRef.current[key] !== seq) return;

      if (!res.ok) {
        patchFeed((cur) => ({
          ...cur,
          loading: false,
          loadingMore: false,
          error: res.reason,
          loadedOnce: true,
        }));
        return;
      }

      syncVersionsForHits(res.hits);
      patchFeed((cur) => ({
        hits: mode === "more" ? mergeUniqueNpmHits(cur.hits, res.hits) : res.hits,
        nextFrom: res.from + res.rawCount,
        total: res.total,
        hasMore: res.hasMore,
        registry: res.registry,
        loading: false,
        loadingMore: false,
        error: null,
        loadedOnce: true,
      }));
    },
    [syncVersionsForHits],
  );

  // 切换到「公开」子页、切换实时频道或切换国内/国外源时自动拉取首屏浏览流。
  useEffect(() => {
    if (tab !== "public") return;
    if (npmHasSearched) return;
    if (!activeBrowseChannel.query) return;
    if (currentBrowseFeed.loadedOnce || currentBrowseFeed.loading) return;
    void loadBrowseChannel(activeBrowseChannel, region, "initial");
  }, [
    tab,
    npmHasSearched,
    activeBrowseChannel,
    region,
    currentBrowseFeed.loadedOnce,
    currentBrowseFeed.loading,
    loadBrowseChannel,
  ]);

  async function handleSearchNpm(overrideQuery?: string) {
    const q = (overrideQuery ?? npmQuery).trim();
    if (!q || npmSearching) return;
    if (overrideQuery !== undefined) setNpmQuery(q);
    Keyboard.dismiss();
    setNpmSearching(true);
    setNpmSearchError(null);
    setNpmHasSearched(true);
    try {
      const res = await searchNpmPackages(q, region, { size: BROWSE_PAGE_SIZE, from: 0 });
      if (!res.ok) {
        setNpmSearchError(res.reason);
        setNpmHits([]);
        setNpmHasMore(false);
        setNpmNextFrom(0);
        setNpmTotal(0);
        return;
      }
      setNpmHits(res.hits);
      setNpmNextFrom(res.from + res.rawCount);
      setNpmTotal(res.total);
      setNpmHasMore(res.hasMore);
      setNpmSearchRegistry(res.registry);
      syncVersionsForHits(res.hits);
    } finally {
      setNpmSearching(false);
    }
  }

  async function handleLoadMoreSearch() {
    const q = npmQuery.trim();
    if (!q || npmSearching || npmLoadingMore || !npmHasMore) return;
    setNpmLoadingMore(true);
    try {
      const res = await searchNpmPackages(q, region, {
        size: BROWSE_PAGE_SIZE,
        from: npmNextFrom,
      });
      if (!res.ok) {
        setNpmSearchError(res.reason);
        return;
      }
      setNpmHits((prev) => mergeUniqueNpmHits(prev, res.hits));
      setNpmNextFrom(res.from + res.rawCount);
      setNpmTotal(res.total);
      setNpmHasMore(res.hasMore);
      setNpmSearchRegistry(res.registry);
      syncVersionsForHits(res.hits);
    } finally {
      setNpmLoadingMore(false);
    }
  }

  function clearNpmSearch() {
    setNpmQuery("");
    setNpmHits([]);
    setNpmNextFrom(0);
    setNpmTotal(0);
    setNpmHasMore(false);
    setNpmSearchError(null);
    setNpmHasSearched(false);
  }

  async function executeNpmCommunityInstall(target: {
    packageName: string;
    version?: string;
    displayName: string;
    description?: string;
    origin: "npm-search" | "personal";
  }) {
    if (busyId) return;
    const id = npmPluginIdFor(target.packageName);
    const spec = target.version ? `${target.packageName}@${target.version}` : target.packageName;
    setBusyId(id);
    setMessage(`正在通过${marketRegionLabel(region)}内置 npm 安装 ${spec}…`);
    try {
      const outcome = await installPersonalNpmPlugin(spec, {
        displayName: target.displayName,
        description: target.description,
        region,
        origin: target.origin,
        onStatus: (statusText) => setMessage(statusText),
      });
      if (!outcome.ok) {
        setMessage(`${target.displayName} 安装失败：${outcome.reason}`);
        return;
      }
      setVersions((current) => ({ ...current, [outcome.dir]: outcome.manifest.version }));
      await plugins.reload();
      const warnSuffix =
        outcome.warnings && outcome.warnings.length > 0 ? `（${outcome.warnings[0]}）` : "";
      setMessage(`${outcome.manifest.name} v${outcome.manifest.version} 已安装并启用${warnSuffix}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddPersonalNpm() {
    const spec = personalNpmSpecInput.trim();
    if (!spec || !personalNpmRiskAccepted || addingNpm) return;
    Keyboard.dismiss();
    setAddingNpm(true);
    setMessage(`正在通过${marketRegionLabel(region)}内置 npm 安装 ${spec}…`);
    try {
      const outcome = await installPersonalNpmPlugin(spec, {
        displayName: personalNpmNameInput.trim() || undefined,
        region,
        origin: "personal",
        onStatus: (statusText) => setMessage(statusText),
      });
      if (!outcome.ok) {
        setMessage(`npm 安装失败：${outcome.reason}`);
        return;
      }
      const sourceUrl = `npm:${spec}`;
      const sourceEntry: PersonalPluginSource = {
        id: `npm-${Date.now()}`,
        name: personalNpmNameInput.trim() || outcome.manifest.name,
        url: sourceUrl,
        kind: "npm",
        addedAt: new Date().toISOString(),
        installedPluginId: outcome.manifest.id,
      };
      const next = [
        sourceEntry,
        ...personalSources.filter(
          (item) => item.url !== sourceUrl && item.installedPluginId !== outcome.manifest.id,
        ),
      ];
      setPersonalSources(next);
      await savePersonalSources(next);
      setVersions((current) => ({ ...current, [outcome.manifest.id]: outcome.manifest.version }));
      await plugins.reload();
      setAddNpmOpen(false);
      setPersonalNpmNameInput("");
      setPersonalNpmSpecInput("");
      setPersonalNpmRiskAccepted(false);
      setMessage(`已通过 npm 安装 ${outcome.manifest.name} v${outcome.manifest.version}`);
    } finally {
      setAddingNpm(false);
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

  // 精选推荐 npm MCP 自动与远端签名索引按 id 去重
  const visibleFeaturedNpmMcps = useMemo(() => {
    const remoteIds = new Set(allRemoteEntries.map((item) => item.id));
    return FEATURED_NPM_MCPS.filter((item) => !remoteIds.has(item.id));
  }, [allRemoteEntries]);

  // 本地已安装的个人/第三方插件（既不是内置插件，也不在公开策展和远端公开索引中）
  const localPersonalPlugins = useMemo(() => {
    const curatedIds = new Set([
      ...CURATED_PUBLIC_PLUGINS.map((item) => item.id),
      ...FEATURED_NPM_MCPS.map((item) => item.id),
    ]);
    const remoteIds = new Set(allRemoteEntries.map((item) => item.id));
    return plugins.plugins.filter(
      (plugin) =>
        !plugin.bundled &&
        !curatedIds.has(plugin.parsed.manifest.id) &&
        !remoteIds.has(plugin.parsed.manifest.id),
    );
  }, [plugins.plugins, allRemoteEntries]);

  const renderNpmHitCard = (hit: NpmSearchHit) => {
    const pluginId = npmPluginIdFor(hit.name);
    const installedVer =
      versions[pluginId] ?? readInstalledManifest(pluginId)?.version ?? null;
    const isBusy = busyId === pluginId;
    const isDesktopOnly = hit.suitability === "desktop-only";
    return (
      <View
        key={hit.name}
        style={[
          styles.card,
          { backgroundColor: t.card, borderColor: t.hairline },
        ]}
      >
        <Pressable
          onPress={() => setPublicDetail({ kind: "npm", hit })}
          accessibilityRole="button"
          accessibilityLabel={`查看 ${hit.name} 详情`}
          style={({ pressed }) => [styles.cardBodyTap, pressed ? { opacity: 0.78 } : null]}
        >
          <View style={styles.cardHead}>
            <View style={styles.cardTitleWrap}>
              <View style={styles.titleBadgeRow}>
                <Text style={[styles.hitName, { color: t.ink }]} numberOfLines={1}>
                  {hit.name}
                </Text>
                {hit.looksLikeMcp ? (
                  <StatusPill bg={t.brandSoft} color={t.brand} label="MCP" />
                ) : null}
                {isDesktopOnly ? (
                  <StatusPill bg={t.amberSoft} color={t.amber} label="需桌面环境" />
                ) : null}
              </View>
              <Text style={[styles.meta, { color: t.inkFaint }]} numberOfLines={1}>
                v{hit.version} · {hit.author} · 社区未审
              </Text>
            </View>
            {installedVer ? (
              <StatusPill bg={t.okSoft} color={t.ok} label={`已安装 v${installedVer}`} />
            ) : (
              <Icon name="chevron-right" size={14} color={t.inkGhost} />
            )}
          </View>
          {hit.description ? (
            <Text style={[styles.description, { color: t.inkSub }]} numberOfLines={2}>
              {hit.description}
            </Text>
          ) : null}
          {hit.mobileHint ? (
            <Text style={[styles.mobileWarnText, { color: t.amber }]} numberOfLines={1}>
              {hit.mobileHint}
            </Text>
          ) : null}
        </Pressable>
        <View style={styles.actions}>
          <PillButton
            label={isBusy ? "安装中…" : installedVer === null ? "安装" : "重新安装"}
            variant="primary"
            buttonSize="sm"
            disabled={isBusy || busyId !== null}
            onPress={() =>
              setPendingNpmConfirm({
                packageName: hit.name,
                version: hit.version,
                displayName: hit.name,
                description: hit.description,
                origin: "npm-search",
              })
            }
          />
          {installedVer !== null && !isBusy ? (
            <PillButton
              label="卸载"
              variant="danger"
              buttonSize="sm"
              onPress={() => void uninstall(pluginId, hit.name)}
            />
          ) : null}
        </View>
      </View>
    );
  };

  const renderPublicDetailBody = () => {
    if (!publicDetail) return null;

    if (publicDetail.kind === "npm") {
      const { hit } = publicDetail;
      const pluginId = npmPluginIdFor(hit.name);
      const installedVer =
        versions[pluginId] ?? readInstalledManifest(pluginId)?.version ?? null;
      const isBusy = busyId === pluginId;
      const linkUrl =
        safeExternalHttpsUrl(hit.homepage) ??
        safeExternalHttpsUrl(hit.repository) ??
        `https://www.npmjs.com/package/${hit.name}`;
      return (
        <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailBody}>
          <View style={styles.titleBadgeRow}>
            {hit.looksLikeMcp ? <StatusPill bg={t.brandSoft} color={t.brand} label="npm MCP" /> : null}
            <StatusPill bg={t.surfaceSoft} color={t.inkSub} label={`v${hit.version}`} />
            {hit.suitability === "desktop-only" ? (
              <StatusPill bg={t.amberSoft} color={t.amber} label="需桌面环境" />
            ) : null}
            {installedVer ? (
              <StatusPill bg={t.okSoft} color={t.ok} label={`已安装 v${installedVer}`} />
            ) : null}
          </View>
          <Text style={[styles.meta, { color: t.inkFaint }]}>
            包名：{hit.name} · 作者：{hit.author}
          </Text>
          <Text style={[styles.detailDesc, { color: t.ink }]}>
            {hit.description || "该开源包未提供简介，可先查看项目主页再决定是否安装。"}
          </Text>
          <View
            style={[
              styles.detailNotice,
              {
                backgroundColor: hit.suitability === "desktop-only" ? t.amberSoft : t.surfaceSoft,
                borderColor: t.hairline,
              },
            ]}
          >
            <Text
              style={[
                styles.hint,
                { color: hit.suitability === "desktop-only" ? t.amber : t.inkSub },
              ]}
            >
              {hit.mobileHint
                ? `${hit.mobileHint}。该包来自 npm 公共社区，安装器会自动跳过脚本并拦截原生二进制。`
                : "来自 npm 公共社区（未经官方审核），安装时强制 --ignore-scripts 拦截原生二进制，并自动探测所需 API Key / 环境变量。"}
            </Text>
          </View>
          {hit.keywords.length > 0 ? (
            <View style={styles.quickChipRow}>
              {hit.keywords.map((kw) => (
                <View
                  key={kw}
                  style={[
                    styles.detailTag,
                    { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
                  ]}
                >
                  <Text style={[styles.detailTagText, { color: t.inkSub }]}>#{kw}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {linkUrl ? (
            <PressableScale
              onPress={() => void Linking.openURL(linkUrl)}
              accessibilityRole="link"
              accessibilityLabel={`打开 ${hit.name} 主页`}
              style={[
                styles.detailLinkRow,
                { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
              ]}
            >
              <Icon name="globe" size={14} color={t.brand} />
              <Text style={[styles.detailLinkText, { color: t.inkSub }]} numberOfLines={1}>
                {linkUrl}
              </Text>
              <Icon name="chevron-right" size={13} color={t.inkGhost} />
            </PressableScale>
          ) : null}
          <View style={styles.sheetActions}>
            {installedVer ? (
              <PillButton
                label="插件中心配置"
                variant="secondary"
                onPress={() => {
                  setPublicDetail(null);
                  router.push("/plugins");
                }}
              />
            ) : null}
            <PillButton
              label={isBusy ? "安装中…" : installedVer === null ? "安装" : "重新安装"}
              variant="primary"
              disabled={isBusy || busyId !== null}
              onPress={() => {
                setPublicDetail(null);
                setPendingNpmConfirm({
                  packageName: hit.name,
                  version: hit.version,
                  displayName: hit.name,
                  description: hit.description,
                  origin: "npm-search",
                });
              }}
            />
          </View>
        </ScrollView>
      );
    }

    if (publicDetail.kind === "featured") {
      const { item } = publicDetail;
      const installedVer = versions[item.id] ?? null;
      const isBusy = busyId === item.id;
      const linkUrl = safeExternalHttpsUrl(item.homepage);
      const needsKey = item.envHint.includes("需配置");
      return (
        <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailBody}>
          <View style={styles.titleBadgeRow}>
            <StatusPill bg={t.brandSoft} color={t.brand} label="精选 npm MCP" />
            <StatusPill bg={t.surfaceSoft} color={t.inkSub} label={item.category} />
            <StatusPill
              bg={needsKey ? t.amberSoft : t.okSoft}
              color={needsKey ? t.amber : t.ok}
              label={item.envHint}
            />
            {installedVer ? (
              <StatusPill bg={t.okSoft} color={t.ok} label={`已安装 v${installedVer}`} />
            ) : null}
          </View>
          <Text style={[styles.meta, { color: t.inkFaint }]}>
            包名：{item.packageName} · 提供方：{item.publisher}
          </Text>
          <Text style={[styles.detailDesc, { color: t.ink }]}>{item.description}</Text>
          <View
            style={[
              styles.detailNotice,
              { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
            ]}
          >
            <Text style={[styles.hint, { color: t.inkSub }]}>
              {needsKey
                ? "已验证纯 JS 手机可运行。安装后前往「插件中心」填入对应 API Key，新开会话即可使用。"
                : "已验证纯 JS 手机可运行，免配置外部密钥；安装后新开会话即可由助手直接调用。"}
            </Text>
          </View>
          {item.keywords.length > 0 ? (
            <View style={styles.quickChipRow}>
              {item.keywords.map((kw) => (
                <View
                  key={kw}
                  style={[
                    styles.detailTag,
                    { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
                  ]}
                >
                  <Text style={[styles.detailTagText, { color: t.inkSub }]}>#{kw}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {linkUrl ? (
            <PressableScale
              onPress={() => void Linking.openURL(linkUrl)}
              accessibilityRole="link"
              accessibilityLabel={`打开 ${item.name} 主页`}
              style={[
                styles.detailLinkRow,
                { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
              ]}
            >
              <Icon name="globe" size={14} color={t.brand} />
              <Text style={[styles.detailLinkText, { color: t.inkSub }]} numberOfLines={1}>
                {linkUrl}
              </Text>
              <Icon name="chevron-right" size={13} color={t.inkGhost} />
            </PressableScale>
          ) : null}
          <View style={styles.sheetActions}>
            {installedVer ? (
              <PillButton
                label="插件中心配置"
                variant="secondary"
                onPress={() => {
                  setPublicDetail(null);
                  router.push("/plugins");
                }}
              />
            ) : null}
            <PillButton
              label={isBusy ? "安装中…" : installedVer === null ? "安装" : "重新安装"}
              variant="primary"
              disabled={isBusy || busyId !== null}
              onPress={() => {
                setPublicDetail(null);
                void executeNpmCommunityInstall({
                  packageName: item.packageName,
                  displayName: item.name,
                  description: item.description,
                  origin: "npm-search",
                });
              }}
            />
          </View>
        </ScrollView>
      );
    }

    if (publicDetail.kind === "curated") {
      const { item } = publicDetail;
      const installedVer = versions[item.id] ?? null;
      const isBusy = busyId === item.id;
      return (
        <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailBody}>
          <View style={styles.titleBadgeRow}>
            <StatusPill bg={t.surfaceSoft} color={t.inkSub} label="开源技能包" />
            <StatusPill bg={t.okSoft} color={t.ok} label="离线可用 · 免密钥" />
            {installedVer ? (
              <StatusPill bg={t.okSoft} color={t.ok} label={`已安装 v${installedVer}`} />
            ) : null}
          </View>
          <Text style={[styles.meta, { color: t.inkFaint }]}>
            v{item.version} · {item.publisher}
          </Text>
          <Text style={[styles.detailDesc, { color: t.ink }]}>{item.description}</Text>
          <View style={styles.sheetActions}>
            {installedVer ? (
              <PillButton
                label="卸载"
                variant="danger"
                onPress={() => {
                  setPublicDetail(null);
                  void uninstall(item.id, item.name);
                }}
              />
            ) : null}
            <PillButton
              label={installedVer === null ? "安装" : "重新安装"}
              variant="primary"
              disabled={isBusy || busyId !== null}
              onPress={() => {
                setPublicDetail(null);
                void installCuratedPublic(item);
              }}
            />
          </View>
        </ScrollView>
      );
    }

    const { entry } = publicDetail;
    const installedVer = versions[entry.id] ?? null;
    const isBusy = busyId === entry.id;
    return (
      <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailBody}>
        <View style={styles.titleBadgeRow}>
          <StatusPill bg={t.brandSoft} color={t.brand} label="nibi-go-market 验签" />
          <StatusPill
            bg={t.surfaceSoft}
            color={t.inkSub}
            label={
              entry.package.format === "npm"
                ? "npm MCP"
                : entry.kind === "skill"
                  ? "技能包"
                  : "标准 ZIP"
            }
          />
          {installedVer ? (
            <StatusPill bg={t.okSoft} color={t.ok} label={`已安装 v${installedVer}`} />
          ) : null}
        </View>
        <Text style={[styles.meta, { color: t.inkFaint }]}>
          v{entry.version}
          {entry.publisher ? ` · ${entry.publisher}` : ""}
          {entry.license ? ` · ${entry.license}` : ""}
        </Text>
        <Text style={[styles.detailDesc, { color: t.ink }]}>
          {entry.description || "已通过 nibi-go-market 签名校验的公开插件。"}
        </Text>
        <View style={styles.sheetActions}>
          {installedVer ? (
            <PillButton
              label="卸载"
              variant="danger"
              onPress={() => {
                setPublicDetail(null);
                void uninstall(entry.id, entry.name);
              }}
            />
          ) : null}
          <PillButton
            label={installedVer === null ? "安装" : "重新安装"}
            variant="primary"
            disabled={isBusy || busyId !== null}
            onPress={() => {
              setPublicDetail(null);
              void handleInstallPress(entry);
            }}
          />
        </View>
      </ScrollView>
    );
  };

  const publicDetailTitle =
    publicDetail === null
      ? ""
      : publicDetail.kind === "npm"
        ? publicDetail.hit.name
        : publicDetail.kind === "market"
          ? publicDetail.entry.name
          : publicDetail.item.name;

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
        keyboardShouldPersistTaps="handled"
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
                NIBI-GO 独立市场 · {marketRegionLabel(region)}
              </Text>
              <Text style={[styles.mirrorBannerSub, { color: t.inkFaint }]}>
                {region === "cn"
                  ? "目录源：nibi-go-market（jsDelivr / Fastly 验签）· npm 源：npmmirror"
                  : "目录源：nibi-go-market（GitHub Raw 验签）· npm 源：registry.npmjs.org"}
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
              <SectionCard label="随包内置（手机轻量专属 · 开箱即用）">
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
                          "NIBI-GO 手机端轻量内置套件，支持本地 MCP 工具与快捷技能"
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
                    NIBI 手机市场官方扩展
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
            {/* 顶部搜索栏 + 横向分类浏览频道（可搜也可直接逛） */}
            <AppearIn delay={staggerDelay(2, 28, 200)}>
              <View style={styles.publicNavWrap}>
                <View style={styles.searchRow}>
                  <View
                    style={[
                      styles.searchInputWrap,
                      { borderColor: t.hairline, backgroundColor: t.card },
                    ]}
                  >
                    <Icon name="search" size={14} color={t.inkFaint} />
                    <TextInput
                      value={npmQuery}
                      onChangeText={setNpmQuery}
                      onSubmitEditing={() => void handleSearchNpm()}
                      placeholder={`搜 ${region === "cn" ? "npmmirror" : "npmjs"} MCP 包名或关键词`}
                      placeholderTextColor={t.inkGhost}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      style={[styles.searchInput, { color: t.ink }]}
                    />
                    {npmQuery.length > 0 ? (
                      <PressableScale
                        onPress={clearNpmSearch}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="清空搜索词"
                      >
                        <Icon name="x" size={14} color={t.inkFaint} />
                      </PressableScale>
                    ) : null}
                  </View>
                  <PillButton
                    label={npmSearching ? "搜索中…" : "搜索"}
                    variant="primary"
                    buttonSize="sm"
                    disabled={npmSearching || !npmQuery.trim()}
                    onPress={() => void handleSearchNpm()}
                  />
                </View>

                {!npmHasSearched ? (
                  <>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.channelBar}
                    >
                      {PUBLIC_BROWSE_CHANNELS.map((ch) => {
                        const active = ch.id === browseChannel;
                        return (
                          <PressableScale
                            key={ch.id}
                            scaleTo={0.95}
                            onPress={() => setBrowseChannel(ch.id)}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`浏览频道 ${ch.label}`}
                            style={[
                              styles.channelChip,
                              {
                                backgroundColor: active ? t.brand : t.card,
                                borderColor: active ? t.brand : t.hairline,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.channelChipText,
                                { color: active ? "#FFFFFF" : t.inkSub },
                              ]}
                            >
                              {ch.label}
                            </Text>
                          </PressableScale>
                        );
                      })}
                    </ScrollView>

                    <View style={styles.channelMetaRow}>
                      <Text style={[styles.channelSub, { color: t.inkFaint }]} numberOfLines={1}>
                        {activeBrowseChannel.subtitle}
                        {activeBrowseChannel.query && currentBrowseFeed.total > 0
                          ? ` · ${currentBrowseFeed.total.toLocaleString()} 个包`
                          : ""}
                      </Text>
                      {activeBrowseChannel.query ? (
                        <PressableScale
                          onPress={() =>
                            void loadBrowseChannel(activeBrowseChannel, region, "refresh")
                          }
                          disabled={currentBrowseFeed.loading}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`刷新${activeBrowseChannel.label}`}
                          style={styles.channelRefreshBtn}
                        >
                          <Icon name="refresh" size={12} color={t.inkFaint} />
                          <Text style={[styles.channelRefreshText, { color: t.inkFaint }]}>
                            刷新
                          </Text>
                        </PressableScale>
                      ) : null}
                    </View>
                  </>
                ) : null}
              </View>
            </AppearIn>

            {npmHasSearched ? (
              <View style={styles.sectionStack}>
                <View style={styles.channelMetaRow}>
                  <Text style={[styles.sectionHeading, { color: t.inkFaint, flex: 1 }]} numberOfLines={1}>
                    搜索「{npmQuery.trim()}」
                    {npmHits.length > 0
                      ? ` · 已展示 ${npmHits.length}${npmTotal > npmHits.length ? ` / ${npmTotal}` : ""}（${npmSearchRegistry?.replace(/^https:\/\//u, "") ?? "npm"}）`
                      : ""}
                  </Text>
                  <PressableScale
                    onPress={clearNpmSearch}
                    accessibilityRole="button"
                    accessibilityLabel="返回频道浏览"
                    style={[
                      styles.backBrowseChip,
                      { backgroundColor: t.card, borderColor: t.hairline },
                    ]}
                  >
                    <Text style={[styles.backBrowseText, { color: t.inkSub }]}>返回浏览</Text>
                  </PressableScale>
                </View>

                {npmSearching ? (
                  <View style={styles.loading}>
                    <ActivityIndicator color={t.brand} />
                    <Text style={[styles.hint, { color: t.inkFaint }]}>
                      正在检索 {region === "cn" ? "npmmirror" : "npmjs.org"}…
                    </Text>
                  </View>
                ) : npmSearchError ? (
                  <View style={[styles.empty, { borderColor: t.hairline, backgroundColor: t.card }]}>
                    <Text style={[styles.hint, { color: t.red }]}>{npmSearchError}</Text>
                    <View style={styles.actions}>
                      <PillButton
                        label="重试"
                        variant="secondary"
                        buttonSize="sm"
                        onPress={() => void handleSearchNpm()}
                      />
                    </View>
                  </View>
                ) : npmHits.length === 0 ? (
                  <View style={[styles.empty, { borderColor: t.hairline, backgroundColor: t.card }]}>
                    <Text style={[styles.emptyTitle, { color: t.inkSub }]}>未找到匹配的 npm 包</Text>
                    <Text style={[styles.hint, { color: t.inkFaint }]}>
                      可以换个英文关键词，点「返回浏览」按分类逛，或去「个人」页直接输入完整包名安装。
                    </Text>
                  </View>
                ) : (
                  <>
                    {npmHits.map(renderNpmHitCard)}
                    {npmHasMore ? (
                      <View style={styles.loadMoreWrap}>
                        <PillButton
                          label={npmLoadingMore ? "加载中…" : "加载更多结果"}
                          variant="secondary"
                          disabled={npmLoadingMore}
                          onPress={() => void handleLoadMoreSearch()}
                        />
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            ) : browseChannel === "featured" ? (
              loading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={t.brand} />
                  <Text style={[styles.hint, { color: t.inkFaint }]}>读取公开市场目录…</Text>
                </View>
              ) : (
                <View style={styles.sectionStack}>
                  {publicRemoteEntries.length > 0 ? (
                    <>
                      <Text style={[styles.sectionHeading, { color: t.inkFaint }]}>
                        已审核公开市场（nibi-go-market 验签收录）
                      </Text>
                      {publicRemoteEntries.map((entry, idx) => (
                        <AppearIn key={entry.id} delay={staggerDelay(idx + 3, 28, 200)}>
                          <MarketRow
                            entry={entry}
                            installedVersion={versions[entry.id] ?? null}
                            busy={busyId === entry.id}
                            onInstall={() => void handleInstallPress(entry)}
                            onUninstall={() => void uninstall(entry.id, entry.name)}
                            onCancel={cancelInstall}
                            onPressDetail={() => setPublicDetail({ kind: "market", entry })}
                          />
                        </AppearIn>
                      ))}
                    </>
                  ) : null}

                  {visibleFeaturedNpmMcps.length > 0 ? (
                    <>
                      <Text style={[styles.sectionHeading, { color: t.inkFaint }]}>
                        手机实测精选 MCP（纯 JS · 点击卡片看详情）
                      </Text>
                      {visibleFeaturedNpmMcps.map((item, idx) => {
                        const installedVer = versions[item.id] ?? null;
                        const isBusy = busyId === item.id;
                        const needsKey = item.envHint.includes("需配置");
                        return (
                          <AppearIn key={item.id} delay={staggerDelay(idx + 3, 24, 180)}>
                            <View
                              style={[
                                styles.card,
                                { backgroundColor: t.card, borderColor: t.hairline },
                              ]}
                            >
                              <Pressable
                                onPress={() => setPublicDetail({ kind: "featured", item })}
                                accessibilityRole="button"
                                accessibilityLabel={`查看 ${item.name} 详情`}
                                style={({ pressed }) => [
                                  styles.cardBodyTap,
                                  pressed ? { opacity: 0.78 } : null,
                                ]}
                              >
                                <View style={styles.cardHead}>
                                  <View style={styles.cardTitleWrap}>
                                    <View style={styles.titleBadgeRow}>
                                      <Text style={[styles.name, { color: t.ink }]}>{item.name}</Text>
                                      <StatusPill bg={t.brandSoft} color={t.brand} label={item.category} />
                                      <StatusPill
                                        bg={needsKey ? t.amberSoft : t.okSoft}
                                        color={needsKey ? t.amber : t.ok}
                                        label={item.envHint}
                                      />
                                    </View>
                                    <Text style={[styles.meta, { color: t.inkFaint }]} numberOfLines={1}>
                                      {item.packageName} · {item.publisher}
                                    </Text>
                                  </View>
                                  {installedVer === null ? (
                                    <Icon name="chevron-right" size={14} color={t.inkGhost} />
                                  ) : (
                                    <StatusPill
                                      bg={t.okSoft}
                                      color={t.ok}
                                      label={`已安装 v${installedVer}`}
                                    />
                                  )}
                                </View>
                                <Text
                                  style={[styles.description, { color: t.inkSub }]}
                                  numberOfLines={2}
                                >
                                  {item.description}
                                </Text>
                              </Pressable>
                              <View style={styles.actions}>
                                <PillButton
                                  label={
                                    isBusy
                                      ? "安装中…"
                                      : installedVer === null
                                        ? "安装"
                                        : "重新安装"
                                  }
                                  variant="primary"
                                  buttonSize="sm"
                                  disabled={isBusy || busyId !== null}
                                  onPress={() =>
                                    void executeNpmCommunityInstall({
                                      packageName: item.packageName,
                                      displayName: item.name,
                                      description: item.description,
                                      origin: "npm-search",
                                    })
                                  }
                                  style={styles.primaryButton}
                                />
                                {installedVer !== null && !isBusy ? (
                                  <PillButton
                                    label="卸载"
                                    variant="danger"
                                    buttonSize="sm"
                                    onPress={() => void uninstall(item.id, item.name)}
                                  />
                                ) : null}
                              </View>
                            </View>
                          </AppearIn>
                        );
                      })}
                    </>
                  ) : null}

                  <Text style={[styles.sectionHeading, { color: t.inkFaint }]}>
                    精选开源技能包（离线可用）
                  </Text>
                  {CURATED_PUBLIC_PLUGINS.map((item, idx) => {
                    const installedVer = versions[item.id] ?? null;
                    const isBusy = busyId === item.id;
                    return (
                      <AppearIn key={item.id} delay={staggerDelay(idx + 5, 24, 180)}>
                        <View
                          style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}
                        >
                          <Pressable
                            onPress={() => setPublicDetail({ kind: "curated", item })}
                            accessibilityRole="button"
                            accessibilityLabel={`查看 ${item.name} 详情`}
                            style={({ pressed }) => [
                              styles.cardBodyTap,
                              pressed ? { opacity: 0.78 } : null,
                            ]}
                          >
                            <View style={styles.cardHead}>
                              <View style={styles.cardTitleWrap}>
                                <View style={styles.titleBadgeRow}>
                                  <Text style={[styles.name, { color: t.ink }]}>{item.name}</Text>
                                  <StatusPill bg={t.surfaceSoft} color={t.inkSub} label="技能包" />
                                </View>
                                <Text style={[styles.meta, { color: t.inkFaint }]}>
                                  v{item.version} · {item.publisher}
                                </Text>
                              </View>
                              {installedVer === null ? (
                                <Icon name="chevron-right" size={14} color={t.inkGhost} />
                              ) : (
                                <StatusPill
                                  bg={t.okSoft}
                                  color={t.ok}
                                  label={`已安装 v${installedVer}`}
                                />
                              )}
                            </View>
                            <Text style={[styles.description, { color: t.inkSub }]} numberOfLines={2}>
                              {item.description}
                            </Text>
                          </Pressable>
                          <View style={styles.actions}>
                            <PillButton
                              label={installedVer === null ? "安装" : "重新安装"}
                              variant="primary"
                              buttonSize="sm"
                              disabled={isBusy || busyId !== null}
                              onPress={() => void installCuratedPublic(item)}
                              style={styles.primaryButton}
                            />
                            {installedVer !== null && !isBusy ? (
                              <PillButton
                                label="卸载"
                                variant="danger"
                                buttonSize="sm"
                                onPress={() => void uninstall(item.id, item.name)}
                              />
                            ) : null}
                          </View>
                        </View>
                      </AppearIn>
                    );
                  })}

                  <View
                    style={[
                      styles.exploreBanner,
                      { backgroundColor: t.card, borderColor: t.hairline },
                    ]}
                  >
                    <View style={styles.mirrorBannerTextWrap}>
                      <Text style={[styles.mirrorBannerTitle, { color: t.ink }]}>
                        逛逛实时开源 MCP 生态
                      </Text>
                      <Text style={[styles.mirrorBannerSub, { color: t.inkFaint }]}>
                        切换「热门 MCP / 搜索抓取 / 地图出行 / 开发数据」频道，支持无限翻页探索
                      </Text>
                    </View>
                    <PillButton
                      label="去逛热门"
                      variant="secondary"
                      buttonSize="sm"
                      onPress={() => setBrowseChannel("popular")}
                    />
                  </View>
                </View>
              )
            ) : browseChannel === "skills" ? (
              <View style={styles.sectionStack}>
                {publicRemoteEntries
                  .filter((entry) => entry.kind === "skill")
                  .map((entry) => (
                    <MarketRow
                      key={entry.id}
                      entry={entry}
                      installedVersion={versions[entry.id] ?? null}
                      busy={busyId === entry.id}
                      onInstall={() => void handleInstallPress(entry)}
                      onUninstall={() => void uninstall(entry.id, entry.name)}
                      onCancel={cancelInstall}
                      onPressDetail={() => setPublicDetail({ kind: "market", entry })}
                    />
                  ))}
                {CURATED_PUBLIC_PLUGINS.map((item) => {
                  const installedVer = versions[item.id] ?? null;
                  const isBusy = busyId === item.id;
                  return (
                    <View
                      key={item.id}
                      style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}
                    >
                      <Pressable
                        onPress={() => setPublicDetail({ kind: "curated", item })}
                        accessibilityRole="button"
                        accessibilityLabel={`查看 ${item.name} 详情`}
                        style={({ pressed }) => [
                          styles.cardBodyTap,
                          pressed ? { opacity: 0.78 } : null,
                        ]}
                      >
                        <View style={styles.cardHead}>
                          <View style={styles.cardTitleWrap}>
                            <View style={styles.titleBadgeRow}>
                              <Text style={[styles.name, { color: t.ink }]}>{item.name}</Text>
                              <StatusPill bg={t.surfaceSoft} color={t.inkSub} label="技能包" />
                            </View>
                            <Text style={[styles.meta, { color: t.inkFaint }]}>
                              v{item.version} · {item.publisher}
                            </Text>
                          </View>
                          {installedVer === null ? (
                            <Icon name="chevron-right" size={14} color={t.inkGhost} />
                          ) : (
                            <StatusPill
                              bg={t.okSoft}
                              color={t.ok}
                              label={`已安装 v${installedVer}`}
                            />
                          )}
                        </View>
                        <Text style={[styles.description, { color: t.inkSub }]} numberOfLines={2}>
                          {item.description}
                        </Text>
                      </Pressable>
                      <View style={styles.actions}>
                        <PillButton
                          label={installedVer === null ? "安装" : "重新安装"}
                          variant="primary"
                          buttonSize="sm"
                          disabled={isBusy || busyId !== null}
                          onPress={() => void installCuratedPublic(item)}
                          style={styles.primaryButton}
                        />
                        {installedVer !== null && !isBusy ? (
                          <PillButton
                            label="卸载"
                            variant="danger"
                            buttonSize="sm"
                            onPress={() => void uninstall(item.id, item.name)}
                          />
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              /* 实时 npm 分类浏览频道（自动拉流 + 过滤纯 SDK + 分页加载更多） */
              <View style={styles.sectionStack}>
                {currentBrowseFeed.loading && currentBrowseFeed.hits.length === 0 ? (
                  <View style={styles.loading}>
                    <ActivityIndicator color={t.brand} />
                    <Text style={[styles.hint, { color: t.inkFaint }]}>
                      正在从 {region === "cn" ? "npmmirror" : "npmjs.org"} 拉取「{activeBrowseChannel.label}」…
                    </Text>
                  </View>
                ) : currentBrowseFeed.error && currentBrowseFeed.hits.length === 0 ? (
                  <View style={[styles.empty, { borderColor: t.hairline, backgroundColor: t.card }]}>
                    <Text style={[styles.emptyTitle, { color: t.inkSub }]}>加载频道失败</Text>
                    <Text style={[styles.hint, { color: t.red }]}>{currentBrowseFeed.error}</Text>
                    <View style={styles.actions}>
                      <PillButton
                        label="重新加载"
                        variant="secondary"
                        buttonSize="sm"
                        onPress={() =>
                          void loadBrowseChannel(activeBrowseChannel, region, "refresh")
                        }
                      />
                    </View>
                  </View>
                ) : currentBrowseFeed.hits.length === 0 ? (
                  <View style={[styles.empty, { borderColor: t.hairline, backgroundColor: t.card }]}>
                    <Text style={[styles.emptyTitle, { color: t.inkSub }]}>该频道暂无条目</Text>
                    <Text style={[styles.hint, { color: t.inkFaint }]}>
                      可以切换上方镜像源或直接在搜索框输入关键词查找。
                    </Text>
                  </View>
                ) : (
                  <>
                    {currentBrowseFeed.hits.map(renderNpmHitCard)}
                    {currentBrowseFeed.error ? (
                      <Text style={[styles.hint, { color: t.red }]}>{currentBrowseFeed.error}</Text>
                    ) : null}
                    {currentBrowseFeed.hasMore ? (
                      <View style={styles.loadMoreWrap}>
                        <PillButton
                          label={
                            currentBrowseFeed.loadingMore
                              ? "加载更多中…"
                              : `加载更多（已显示 ${currentBrowseFeed.hits.length} 个）`
                          }
                          variant="secondary"
                          disabled={currentBrowseFeed.loadingMore}
                          onPress={() =>
                            void loadBrowseChannel(activeBrowseChannel, region, "more")
                          }
                        />
                      </View>
                    ) : (
                      <Text style={[styles.loadMoreEnd, { color: t.inkGhost }]}>
                        已展示本频道全部可浏览条目（源：{currentBrowseFeed.registry?.replace(/^https:\/\//u, "") ?? "npm"}）
                      </Text>
                    )}
                  </>
                )}
              </View>
            )}
          </>
        ) : null}

        {tab === "personal" ? (
          <AppearIn delay={staggerDelay(2, 28, 200)}>
            <View style={styles.sectionStack}>
              <SectionCard label="添加个人插件">
                <Row
                  icon="terminal"
                  tone="brand"
                  title="从 npm 安装纯 JS MCP 包"
                  detail="输入包名（如 @modelcontextprotocol/server-sequential-thinking），强制禁脚本并拦截原生二进制"
                  onPress={() => setAddNpmOpen(true)}
                />
                <Divider />
                <Row
                  icon="globe"
                  tone="steel"
                  title="从链接安装标准插件包 (.zip)"
                  detail="支持 GitHub Releases / Raw / jsDelivr 上的 .nibi-plugin、.claude-plugin、.codex-plugin 或纯 skills 包"
                  onPress={() => setAddPersonalOpen(true)}
                />
                <Divider />
                <Row
                  icon="folder"
                  tone="plain"
                  title="从手机本地导入插件包 (.zip)"
                  detail="支持标准 .nibi-plugin/.claude-plugin/.codex-plugin、skills/SKILL.md 或 nibi-go.plugin.json 压缩包"
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
                    你可以直接输入 npm 包名安装纯 JS MCP，粘贴 GitHub Releases / jsDelivr 上的标准插件包直链，或从手机本地导入 .zip 插件包。
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

      {/* 添加个人 npm MCP 包 Sheet */}
      <Sheet
        visible={addNpmOpen}
        onClose={() => setAddNpmOpen(false)}
        title="从 npm 安装纯 JS MCP 包"
      >
        <View style={styles.sheetForm}>
          <Text style={[styles.hint, { color: t.inkSub }]}>
            支持输入 npm 包名、精确版本（如 @scope/pkg@1.0.0）或 npmjs.com 链接，将按当前所选「{marketRegionLabel(region)}」（{region === "cn" ? "npmmirror" : "npmjs.org"}）通过随包内置 npm 以 --ignore-scripts 模式隔离安装。
          </Text>
          <TextInput
            value={personalNpmNameInput}
            onChangeText={setPersonalNpmNameInput}
            placeholder="显示名称（可选，留空自动取 npm 包名）"
            placeholderTextColor={t.inkGhost}
            style={[
              styles.input,
              { color: t.ink, borderColor: t.hairline, backgroundColor: t.surfaceSoft },
            ]}
          />
          <TextInput
            value={personalNpmSpecInput}
            onChangeText={setPersonalNpmSpecInput}
            placeholder="@modelcontextprotocol/server-sequential-thinking"
            placeholderTextColor={t.inkGhost}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              { color: t.ink, borderColor: t.hairline, backgroundColor: t.surfaceSoft },
            ]}
          />
          <PressableScale
            onPress={() => setPersonalNpmRiskAccepted((prev) => !prev)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: personalNpmRiskAccepted }}
            style={styles.checkboxRow}
          >
            <View
              style={[
                styles.checkboxBox,
                {
                  borderColor: personalNpmRiskAccepted ? t.brand : t.inkFaint,
                  backgroundColor: personalNpmRiskAccepted ? t.brand : "transparent",
                },
              ]}
            >
              {personalNpmRiskAccepted ? <Icon name="check" size={12} color="#FFFFFF" /> : null}
            </View>
            <Text style={[styles.checkboxLabel, { color: t.inkSub }]}>
              我了解该 npm 包来自公共社区且未经 NIBI 官方审核，并确认在手机端禁用安装脚本的沙箱中运行。
            </Text>
          </PressableScale>
          <View style={styles.sheetActions}>
            <PillButton
              label="取消"
              variant="secondary"
              onPress={() => setAddNpmOpen(false)}
            />
            <PillButton
              label={addingNpm ? "正在安装…" : "校验并安装"}
              variant="primary"
              disabled={!personalNpmSpecInput.trim() || !personalNpmRiskAccepted || addingNpm}
              onPress={() => void handleAddPersonalNpm()}
            />
          </View>
        </View>
      </Sheet>

      {/* 公开市场插件轻量详情 Sheet */}
      <Sheet
        visible={publicDetail !== null}
        onClose={() => setPublicDetail(null)}
        title={publicDetailTitle}
      >
        {renderPublicDetailBody()}
      </Sheet>

      {/* 社区实时搜索 npm 包安装前安全确认 */}
      <ConfirmDialog
        visible={pendingNpmConfirm !== null}
        title="安装 npm 公共社区包"
        message={
          pendingNpmConfirm
            ? `「${pendingNpmConfirm.packageName}${pendingNpmConfirm.version ? `@${pendingNpmConfirm.version}` : ""}」来自 npm 公共源，未经 NIBI 官方审核。\n\n安装器将强制跳过所有安装脚本（--ignore-scripts）并拦截原生二进制文件。确认继续安装？`
            : ""
        }
        confirmLabel="确认安装"
        cancelLabel="取消"
        onConfirm={() => {
          const target = pendingNpmConfirm;
          setPendingNpmConfirm(null);
          if (target) void executeNpmCommunityInstall(target);
        }}
        onCancel={() => setPendingNpmConfirm(null)}
      />

      {/* 添加个人插件源 Sheet */}
      <Sheet
        visible={addPersonalOpen}
        onClose={() => setAddPersonalOpen(false)}
        title="添加标准插件包地址 (.zip)"
      >
        <View style={styles.sheetForm}>
          <Text style={[styles.hint, { color: t.inkSub }]}>
            支持填写 GitHub Releases / Raw、jsDelivr 或个人服务器上的标准插件包（.nibi-plugin / .claude-plugin / .codex-plugin / skills / nibi-go.plugin.json）HTTPS 地址，下载时自动按当前「{marketRegionLabel(region)}」加速。
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
  titleBadgeRow: { flexDirection: "row", alignItems: "center", gap: space(1.5), flexWrap: "wrap" },
  name: { ...text("bodyLg"), fontWeight: "700" },
  hitName: { ...text("body"), fontWeight: "700", flexShrink: 1 },
  meta: { ...text("micro"), marginTop: space(0.5) },
  searchRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  searchInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    height: size.button,
  },
  searchInput: { flex: 1, ...text("small"), paddingVertical: 0 },
  quickChipRow: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  quickChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  quickChipText: { ...text("micro"), fontWeight: "600" },
  searchStatusRow: { flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(1) },
  searchResults: { gap: space(2), marginTop: space(0.5) },
  searchHitCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2.5),
    gap: space(1.5),
  },
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
  publicNavWrap: {
    gap: space(2),
  },
  channelBar: {
    gap: space(1.5),
    paddingVertical: space(0.5),
  },
  channelChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
  },
  channelChipText: {
    ...text("small"),
    fontWeight: "600",
  },
  channelMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
    paddingHorizontal: space(0.5),
  },
  channelSub: {
    ...text("micro"),
    flex: 1,
  },
  channelRefreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
  },
  channelRefreshText: {
    ...text("micro"),
    fontWeight: "600",
  },
  backBrowseChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  backBrowseText: {
    ...text("micro"),
    fontWeight: "600",
  },
  cardBodyTap: {
    gap: space(1.5),
  },
  mobileWarnText: {
    ...text("micro"),
    fontWeight: "600",
  },
  loadMoreWrap: {
    alignItems: "center",
    paddingVertical: space(1.5),
  },
  loadMoreEnd: {
    ...text("micro"),
    textAlign: "center",
    paddingVertical: space(1.5),
  },
  exploreBanner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2.5),
  },
  detailScroll: {
    maxHeight: 420,
  },
  detailBody: {
    paddingHorizontal: space(4),
    paddingBottom: space(3),
    gap: space(2.5),
  },
  detailDesc: {
    ...text("body"),
  },
  detailNotice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2.5),
  },
  detailTag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: space(0.75),
  },
  detailTagText: {
    ...text("micro"),
    fontWeight: "600",
  },
  detailLinkRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
  },
  detailLinkText: {
    ...text("micro"),
    flex: 1,
  },
});
