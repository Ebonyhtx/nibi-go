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
import { pickText, useI18n } from "../i18n";
import { useResponsiveBodyStyle } from "../layout/responsive";
import { AppearIn, staggerDelay } from "../motion/appear";
import { PressableScale } from "../motion/PressableScale";
import { pluginDisplayDescription, pluginDisplayName } from "../plugins/builtinI18n";
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

interface CuratedPublicPlugin {
  id: string;
  name: string;
  nameEn: string;
  version: string;
  publisher: string;
  description: string;
  descriptionEn: string;
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
    nameEn: "Git Diff & Commit Review",
    version: "1.0.0",
    publisher: "Open Community",
    description: "梳理工作区 Git 变更差异、按 Conventional Commits 规范生成提交说明并排查潜在冲突。",
    descriptionEn: "Review workspace Git diffs, draft Conventional Commits messages, and spot merge risks.",
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
    nameEn: "HTTP API Inspector",
    version: "1.0.0",
    publisher: "Open Community",
    description: "快速构造 REST / GraphQL 请求参数、解析响应结构并生成接口联调诊断报告。",
    descriptionEn: "Build REST/GraphQL requests, inspect response payloads, and diagnose integration errors.",
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
    nameEn: "SQL Modeling & Tuning",
    version: "1.0.0",
    publisher: "Open Community",
    description: "辅助设计数据库表结构、编写复杂聚合查询并分析索引与慢查询瓶颈。",
    descriptionEn: "Design database schemas, craft complex aggregations, and optimize indexes & slow queries.",
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
    nameEn: "Unit Test & Edge-Case Architect",
    version: "1.0.0",
    publisher: "Open Community",
    description: "针对核心业务函数自动推导正常路径、边界条件与异常分支测试，提升代码覆盖率。",
    descriptionEn: "Derive happy-path, boundary, and error-branch unit tests for core business logic.",
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
  nameEn: string;
  publisher: string;
  category: string;
  categoryEn: string;
  envHint: string;
  envHintEn: string;
  needsKey: boolean;
  description: string;
  descriptionEn: string;
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
    nameEn: "Sequential Thinking",
    publisher: "Model Context Protocol",
    category: "推理规划",
    categoryEn: "Reasoning",
    envHint: "免密钥 · 装完即用",
    envHintEn: "No key needed",
    needsKey: false,
    description: "官方纯 JS 分步推理 MCP 服务器，辅助复杂问题的多步拆解、修订与分支验证。",
    descriptionEn: "Official pure-JS step-by-step reasoning MCP server for breaking down and verifying complex tasks.",
    keywords: ["mcp", "thinking", "reasoning", "official"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: npmPluginIdFor("@modelcontextprotocol/server-memory"),
    packageName: "@modelcontextprotocol/server-memory",
    name: "知识图谱记忆（Memory）",
    nameEn: "Knowledge Graph Memory",
    publisher: "Model Context Protocol",
    category: "知识记忆",
    categoryEn: "Memory",
    envHint: "免密钥 · 装完即用",
    envHintEn: "No key needed",
    needsKey: false,
    description: "官方纯 JS 实体与关系知识图谱 MCP，支持在本地持久记录与检索结构化记忆。",
    descriptionEn: "Official pure-JS entity-relation knowledge graph MCP for persistent structured memory.",
    keywords: ["mcp", "memory", "knowledge-graph", "official"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: npmPluginIdFor("amap-mcp-server"),
    packageName: "amap-mcp-server",
    name: "高德地图 MCP",
    nameEn: "AMap Maps MCP",
    publisher: "AMap Community",
    category: "地图出行",
    categoryEn: "Maps",
    envHint: "需配置 AMAP_KEY",
    envHintEn: "Requires AMAP_KEY",
    needsKey: true,
    description: "提供路径规划、地理编码、POI 搜索、周边检索、实时天气与路线导航能力。",
    descriptionEn: "Routing, geocoding, POI & nearby search, live weather, and navigation powered by AMap.",
    keywords: ["mcp", "amap", "map", "weather", "navigation"],
    homepage: "https://www.npmjs.com/package/amap-mcp-server",
  },
  {
    id: npmPluginIdFor("bing-cn-mcp"),
    packageName: "bing-cn-mcp",
    name: "必应中文搜索",
    nameEn: "Bing CN Search",
    publisher: "Open Community",
    category: "联网搜索",
    categoryEn: "Search",
    envHint: "免密钥 · 装完即用",
    envHintEn: "No key needed",
    needsKey: false,
    description: "必应中文实时网页搜索 MCP 服务器，支持快速检索中文资讯与网页摘要。",
    descriptionEn: "Live Bing web search MCP server with fast Chinese & web snippets.",
    keywords: ["mcp", "bing", "search", "web"],
    homepage: "https://www.npmjs.com/package/bing-cn-mcp",
  },
  {
    id: npmPluginIdFor("mcp-fetch-server"),
    packageName: "mcp-fetch-server",
    name: "网页抓取（Fetch）",
    nameEn: "Web Fetch",
    publisher: "Open Community",
    category: "网页工具",
    categoryEn: "Web",
    envHint: "免密钥 · 装完即用",
    envHintEn: "No key needed",
    needsKey: false,
    description: "将任意公开网页抓取并转换为干净的 Markdown / 纯文本，便于交给助手阅读总结。",
    descriptionEn: "Fetch any public web page as clean Markdown or plain text for reading and summarization.",
    keywords: ["mcp", "fetch", "web", "markdown"],
    homepage: "https://www.npmjs.com/package/mcp-fetch-server",
  },
  {
    id: npmPluginIdFor("open-meteo-mcp-server"),
    packageName: "open-meteo-mcp-server",
    name: "全球天气预报（Open-Meteo）",
    nameEn: "Global Weather (Open-Meteo)",
    publisher: "Open Community",
    category: "天气生活",
    categoryEn: "Weather",
    envHint: "免密钥 · 装完即用",
    envHintEn: "No key needed",
    needsKey: false,
    description: "基于 Open-Meteo 免费气象接口查询全球城市实时天气、逐小时预报与空气质量。",
    descriptionEn: "Global real-time weather, hourly forecasts, and air quality via free Open-Meteo APIs.",
    keywords: ["mcp", "weather", "open-meteo", "forecast"],
    homepage: "https://www.npmjs.com/package/open-meteo-mcp-server",
  },
  {
    id: npmPluginIdFor("@upstash/context7-mcp"),
    packageName: "@upstash/context7-mcp",
    name: "Context7 开发文档",
    nameEn: "Context7 Library Docs",
    publisher: "Upstash",
    category: "开发文档",
    categoryEn: "Docs",
    envHint: "免密钥即可使用（支持可选 Key）",
    envHintEn: "No key needed (optional key)",
    needsKey: false,
    description: "实时拉取最新版主流框架与开源库的官方文档及代码示例，减少模型过时 API 幻觉。",
    descriptionEn: "Fetch up-to-date official docs and code examples for popular libraries to avoid stale APIs.",
    keywords: ["mcp", "docs", "context7", "developer"],
    homepage: "https://github.com/upstash/context7",
  },
  {
    id: npmPluginIdFor("howtocook-mcp"),
    packageName: "howtocook-mcp",
    name: "今日吃什么 · 菜谱大全",
    nameEn: "HowToCook Recipes",
    publisher: "Open Community",
    category: "生活实用",
    categoryEn: "Lifestyle",
    envHint: "免密钥 · 装完即用",
    envHintEn: "No key needed",
    needsKey: false,
    description: "内置丰富家常菜谱，支持按食材、口味或人数推荐三餐搭配并给出详细步骤。",
    descriptionEn: "Curated home-cooking recipes with meal recommendations by ingredients, taste, or servings.",
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
      return pickText(`拉取失败：${detail}`, `Fetch failed: ${detail}`);
    case "verify":
      return pickText(
        `验签失败（${detail}）——已拒绝这份索引`,
        `Signature check failed (${detail}) — index rejected`,
      );
    case "rollback":
      return pickText(`已拒绝回滚：${detail}`, `Rollback rejected: ${detail}`);
    case "pins":
      return pickText(`插件版本不变量冲突：${detail}`, `Version pin conflict: ${detail}`);
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
  const { pick } = useI18n();
  const hasUpdate =
    installedVersion !== null && comparePluginVersions(entry.version, installedVersion) > 0;
  const action =
    installedVersion === null
      ? pick("安装", "Install")
      : hasUpdate
        ? pick("更新", "Update")
        : pick("重新安装", "Reinstall");
  const formatTag =
    entry.package.format === "npm"
      ? "npm MCP"
      : entry.kind === "skill"
        ? pick("技能包", "Skill pack")
        : pick("标准 ZIP", "ZIP");
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
          <StatusPill bg={t.surfaceSoft} color={t.inkFaint} label={pick("未安装", "Not installed")} />
        ) : hasUpdate ? (
          <StatusPill bg={t.amberSoft} color={t.amber} label={pick("可更新", "Update")} />
        ) : (
          <StatusPill
            bg={t.okSoft}
            color={t.ok}
            label={pick(`已安装 v${installedVersion}`, `Installed v${installedVersion}`)}
          />
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
          accessibilityLabel={pick(`查看 ${entry.name} 详情`, `View details for ${entry.name}`)}
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
            label={pick("取消", "Cancel")}
            variant="secondary"
            onPress={onCancel}
            accessibilityLabel={pick(`取消安装 ${entry.name}`, `Cancel installing ${entry.name}`)}
          />
        ) : null}
        {installedVersion !== null && !busy ? (
          <PillButton
            label={pick("卸载", "Uninstall")}
            variant="danger"
            disabled={busy}
            onPress={onUninstall}
            accessibilityLabel={pick(`卸载 ${entry.name}`, `Uninstall ${entry.name}`)}
          />
        ) : null}
      </View>
    </View>
  );
}

export default function MarketScreen() {
  const t = useNibiTheme();
  const { pick } = useI18n();
  const insets = useSafeAreaInsets();
  const bodyStyle = useResponsiveBodyStyle({
    paddingTop: space(2),
    paddingBottom: insets.bottom + space(6),
    gap: space(3),
  });
  const marketTabs = useMemo<readonly SegmentedOption<MarketTab>[]>(
    () => [
      { value: "nibi", label: "NIBI" },
      { value: "public", label: pick("公开", "Public") },
      { value: "personal", label: pick("个人", "Personal") },
    ],
    [pick],
  );
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
            ? pick(
                `已同步（${marketRegionLabel(activeRegion)}，最新索引）`,
                `Synced (${marketRegionLabel(activeRegion)}, up to date)`,
              )
            : pick(
                `已从${marketRegionLabel(activeRegion)}更新索引`,
                `Updated index from ${marketRegionLabel(activeRegion)}`,
              ),
        );
      } else {
        setMessage(
          pick(
            `已同步（${marketRegionLabel(activeRegion)}，已是最新）`,
            `Synced (${marketRegionLabel(activeRegion)}, up to date)`,
          ),
        );
      }
    } catch (error) {
      setMessage(
        pick("刷新失败：", "Refresh failed: ") +
          (error instanceof Error ? error.message : String(error)),
      );
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
        ? pick(
            "已切换为国内源（优先 jsDelivr / npmmirror 镜像）",
            "Switched to CN Mirror (jsDelivr / npmmirror first)",
          )
        : pick(
            "已切换为国外源（优先 GitHub Raw / npmjs 官方源）",
            "Switched to Global (GitHub Raw / npmjs first)",
          ),
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
      setMessage(
        pick(
          `正在通过${marketRegionLabel(region)}下载并校验 ${entry.name} v${entry.version}…`,
          `Downloading & verifying ${entry.name} v${entry.version} via ${marketRegionLabel(region)}…`,
        ),
      );
    } else {
      setProgress(null);
      setMessage(
        pick(
          `正在通过${marketRegionLabel(region)}内置 npm 安装 ${entry.package.name}@${entry.version}…`,
          `Installing ${entry.package.name}@${entry.version} via built-in npm (${marketRegionLabel(region)})…`,
        ),
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
        const wasCancelled =
          controller.signal.aborted ||
          outcome.reason === "已取消" ||
          outcome.reason === "Cancelled";
        setMessage(
          pick(
            `${entry.name} 安装失败：${outcome.reason}${wasCancelled ? "" : "（可重试）"}`,
            `Failed to install ${entry.name}: ${outcome.reason}${wasCancelled ? "" : " (retryable)"}`,
          ),
        );
        return;
      }
      setVersions((current) => ({ ...current, [entry.id]: outcome.manifest.version }));
      await plugins.reload();
      setMessage(
        pick(
          `${entry.name} v${outcome.manifest.version} 已安装并启用`,
          `${entry.name} v${outcome.manifest.version} installed & enabled`,
        ),
      );
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
      setMessage(pick("正在核验账号授权状态…", "Verifying account license…"));
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
        setMessage(current.error?.message ?? pick("登录未完成，请重试", "Sign-in incomplete; please retry"));
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
      setMessage(
        pick("登录失败：", "Sign-in failed: ") +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  function cancelInstall() {
    abortRef.current?.abort();
  }

  async function uninstall(id: string, name: string) {
    const removed = await uninstallMarketPlugin(id);
    setVersions((current) => ({ ...current, [id]: null }));
    await plugins.reload();
    setMessage(
      removed
        ? pick(`已卸载 ${name}`, `Uninstalled ${name}`)
        : pick(`${name} 未安装`, `${name} is not installed`),
    );
  }

  async function installCuratedPublic(item: CuratedPublicPlugin) {
    if (busyId) return;
    setBusyId(item.id);
    const displayName = pick(item.name, item.nameEn);
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
        setMessage(
          pick(`${displayName} 安装失败：${outcome.reason}`, `Failed to install ${displayName}: ${outcome.reason}`),
        );
        return;
      }
      setVersions((current) => ({ ...current, [item.id]: outcome.manifest.version }));
      await plugins.reload();
      setMessage(
        pick(
          `${displayName} v${outcome.manifest.version} 已安装并启用`,
          `${displayName} v${outcome.manifest.version} installed & enabled`,
        ),
      );
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
    setMessage(
      pick(
        `正在通过${marketRegionLabel(region)}内置 npm 安装 ${spec}…`,
        `Installing ${spec} via built-in npm (${marketRegionLabel(region)})…`,
      ),
    );
    try {
      const outcome = await installPersonalNpmPlugin(spec, {
        displayName: target.displayName,
        description: target.description,
        region,
        origin: target.origin,
        onStatus: (statusText) => setMessage(statusText),
      });
      if (!outcome.ok) {
        setMessage(
          pick(
            `${target.displayName} 安装失败：${outcome.reason}`,
            `Failed to install ${target.displayName}: ${outcome.reason}`,
          ),
        );
        return;
      }
      setVersions((current) => ({ ...current, [outcome.dir]: outcome.manifest.version }));
      await plugins.reload();
      const warnSuffix =
        outcome.warnings && outcome.warnings.length > 0
          ? pick(`（${outcome.warnings[0]}）`, ` (${outcome.warnings[0]})`)
          : "";
      setMessage(
        pick(
          `${outcome.manifest.name} v${outcome.manifest.version} 已安装并启用${warnSuffix}`,
          `${outcome.manifest.name} v${outcome.manifest.version} installed & enabled${warnSuffix}`,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddPersonalNpm() {
    const spec = personalNpmSpecInput.trim();
    if (!spec || !personalNpmRiskAccepted || addingNpm) return;
    Keyboard.dismiss();
    setAddingNpm(true);
    setMessage(
      pick(
        `正在通过${marketRegionLabel(region)}内置 npm 安装 ${spec}…`,
        `Installing ${spec} via built-in npm (${marketRegionLabel(region)})…`,
      ),
    );
    try {
      const outcome = await installPersonalNpmPlugin(spec, {
        displayName: personalNpmNameInput.trim() || undefined,
        region,
        origin: "personal",
        onStatus: (statusText) => setMessage(statusText),
      });
      if (!outcome.ok) {
        setMessage(pick(`npm 安装失败：${outcome.reason}`, `npm install failed: ${outcome.reason}`));
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
      setMessage(
        pick(
          `已通过 npm 安装 ${outcome.manifest.name} v${outcome.manifest.version}`,
          `Installed ${outcome.manifest.name} v${outcome.manifest.version} from npm`,
        ),
      );
    } finally {
      setAddingNpm(false);
    }
  }

  async function handleAddPersonalUrl() {
    const url = personalUrlInput.trim();
    if (!url || !personalRiskAccepted || addingPersonal) return;
    if (!/^https?:\/\//i.test(url)) {
      setMessage(
        pick(
          "请输入以 https:// 或 http:// 开头的插件包 (.zip) 地址",
          "Enter a plugin archive (.zip) URL starting with https:// or http://",
        ),
      );
      return;
    }
    setAddingPersonal(true);
    setMessage(
      pick(
        `正在通过${marketRegionLabel(region)}拉取个人插件包…`,
        `Fetching personal plugin archive via ${marketRegionLabel(region)}…`,
      ),
    );
    try {
      const outcome = await installPersonalUrlPlugin(url, { region });
      if (!outcome.ok) {
        setMessage(pick(`添加失败：${outcome.reason}`, `Add failed: ${outcome.reason}`));
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
      setMessage(
        pick(
          `已从个人源安装 ${outcome.manifest.name} v${outcome.manifest.version}`,
          `Installed ${outcome.manifest.name} v${outcome.manifest.version} from custom URL`,
        ),
      );
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
      setMessage(
        pick(`正在校验本地插件包 ${asset.name}…`, `Verifying local plugin archive ${asset.name}…`),
      );
      const file = new File(asset.uri);
      const bytes = await file.bytes();
      const outcome = await installPluginArchiveBytes(bytes);
      if (!outcome.ok) {
        setMessage(
          pick(`本地插件包导入失败：${outcome.reason}`, `Local import failed: ${outcome.reason}`),
        );
        return;
      }
      setVersions((current) => ({ ...current, [outcome.manifest.id]: outcome.manifest.version }));
      await plugins.reload();
      setMessage(
        pick(
          `已导入并安装 ${outcome.manifest.name} v${outcome.manifest.version}`,
          `Imported & installed ${outcome.manifest.name} v${outcome.manifest.version}`,
        ),
      );
    } catch (error) {
      setMessage(
        pick("读取本地插件包失败：", "Failed to read local archive: ") +
          (error instanceof Error ? error.message : String(error)),
      );
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
    setMessage(
      pick(`已移除个人插件源「${source.name}」`, `Removed custom source "${source.name}"`),
    );
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
          accessibilityLabel={pick(`查看 ${hit.name} 详情`, `View details for ${hit.name}`)}
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
                  <StatusPill bg={t.amberSoft} color={t.amber} label={pick("需桌面环境", "Desktop only")} />
                ) : null}
              </View>
              <Text style={[styles.meta, { color: t.inkFaint }]} numberOfLines={1}>
                v{hit.version} · {hit.author} · {pick("社区未审", "Unverified")}
              </Text>
            </View>
            {installedVer ? (
              <StatusPill
                bg={t.okSoft}
                color={t.ok}
                label={pick(`已安装 v${installedVer}`, `Installed v${installedVer}`)}
              />
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
            label={
              isBusy
                ? pick("安装中…", "Installing…")
                : installedVer === null
                  ? pick("安装", "Install")
                  : pick("重新安装", "Reinstall")
            }
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
              label={pick("卸载", "Uninstall")}
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
              <StatusPill bg={t.amberSoft} color={t.amber} label={pick("需桌面环境", "Desktop only")} />
            ) : null}
            {installedVer ? (
              <StatusPill
                bg={t.okSoft}
                color={t.ok}
                label={pick(`已安装 v${installedVer}`, `Installed v${installedVer}`)}
              />
            ) : null}
          </View>
          <Text style={[styles.meta, { color: t.inkFaint }]}>
            {pick(`包名：${hit.name} · 作者：${hit.author}`, `Package: ${hit.name} · Author: ${hit.author}`)}
          </Text>
          <Text style={[styles.detailDesc, { color: t.ink }]}>
            {hit.description ||
              pick(
                "该开源包未提供简介，可先查看项目主页再决定是否安装。",
                "No description provided. Check the homepage before installing.",
              )}
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
                ? pick(
                    `${hit.mobileHint}。该包来自 npm 公共社区，安装器会自动跳过脚本并拦截原生二进制。`,
                    `${hit.mobileHint}. From the public npm registry; the installer runs with --ignore-scripts and blocks native binaries.`,
                  )
                : pick(
                    "来自 npm 公共社区（未经官方审核），安装时强制 --ignore-scripts 拦截原生二进制，并自动探测所需 API Key / 环境变量。",
                    "From the public npm registry (unverified). Installed with --ignore-scripts, blocking native binaries and auto-detecting required env vars.",
                  )}
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
              accessibilityLabel={pick(`打开 ${hit.name} 主页`, `Open ${hit.name} homepage`)}
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
                label={pick("插件中心配置", "Configure in Plugins")}
                variant="secondary"
                onPress={() => {
                  setPublicDetail(null);
                  router.push("/plugins");
                }}
              />
            ) : null}
            <PillButton
              label={
                isBusy
                  ? pick("安装中…", "Installing…")
                  : installedVer === null
                    ? pick("安装", "Install")
                    : pick("重新安装", "Reinstall")
              }
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
      const itemName = pick(item.name, item.nameEn);
      const itemDesc = pick(item.description, item.descriptionEn);
      const installedVer = versions[item.id] ?? null;
      const isBusy = busyId === item.id;
      const linkUrl = safeExternalHttpsUrl(item.homepage);
      const needsKey = item.needsKey;
      return (
        <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailBody}>
          <View style={styles.titleBadgeRow}>
            <StatusPill bg={t.brandSoft} color={t.brand} label={pick("精选 npm MCP", "Featured MCP")} />
            <StatusPill bg={t.surfaceSoft} color={t.inkSub} label={pick(item.category, item.categoryEn)} />
            <StatusPill
              bg={needsKey ? t.amberSoft : t.okSoft}
              color={needsKey ? t.amber : t.ok}
              label={pick(item.envHint, item.envHintEn)}
            />
            {installedVer ? (
              <StatusPill
                bg={t.okSoft}
                color={t.ok}
                label={pick(`已安装 v${installedVer}`, `Installed v${installedVer}`)}
              />
            ) : null}
          </View>
          <Text style={[styles.meta, { color: t.inkFaint }]}>
            {pick(
              `包名：${item.packageName} · 提供方：${item.publisher}`,
              `Package: ${item.packageName} · Publisher: ${item.publisher}`,
            )}
          </Text>
          <Text style={[styles.detailDesc, { color: t.ink }]}>{itemDesc}</Text>
          <View
            style={[
              styles.detailNotice,
              { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
            ]}
          >
            <Text style={[styles.hint, { color: t.inkSub }]}>
              {needsKey
                ? pick(
                    "已验证纯 JS 手机可运行。安装后前往「插件中心」填入对应 API Key，新开会话即可使用。",
                    "Verified pure-JS mobile MCP. After installing, add the API key in Plugins and start a new chat.",
                  )
                : pick(
                    "已验证纯 JS 手机可运行，免配置外部密钥；安装后新开会话即可由助手直接调用。",
                    "Verified pure-JS mobile MCP with no API key required. Ready in new chats right after install.",
                  )}
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
              accessibilityLabel={pick(`打开 ${itemName} 主页`, `Open ${itemName} homepage`)}
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
                label={pick("插件中心配置", "Configure in Plugins")}
                variant="secondary"
                onPress={() => {
                  setPublicDetail(null);
                  router.push("/plugins");
                }}
              />
            ) : null}
            <PillButton
              label={
                isBusy
                  ? pick("安装中…", "Installing…")
                  : installedVer === null
                    ? pick("安装", "Install")
                    : pick("重新安装", "Reinstall")
              }
              variant="primary"
              disabled={isBusy || busyId !== null}
              onPress={() => {
                setPublicDetail(null);
                void executeNpmCommunityInstall({
                  packageName: item.packageName,
                  displayName: itemName,
                  description: itemDesc,
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
      const itemName = pick(item.name, item.nameEn);
      const installedVer = versions[item.id] ?? null;
      const isBusy = busyId === item.id;
      return (
        <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailBody}>
          <View style={styles.titleBadgeRow}>
            <StatusPill bg={t.surfaceSoft} color={t.inkSub} label={pick("开源技能包", "Open skill pack")} />
            <StatusPill bg={t.okSoft} color={t.ok} label={pick("离线可用 · 免密钥", "Offline · No key")} />
            {installedVer ? (
              <StatusPill
                bg={t.okSoft}
                color={t.ok}
                label={pick(`已安装 v${installedVer}`, `Installed v${installedVer}`)}
              />
            ) : null}
          </View>
          <Text style={[styles.meta, { color: t.inkFaint }]}>
            v{item.version} · {item.publisher}
          </Text>
          <Text style={[styles.detailDesc, { color: t.ink }]}>
            {pick(item.description, item.descriptionEn)}
          </Text>
          <View style={styles.sheetActions}>
            {installedVer ? (
              <PillButton
                label={pick("卸载", "Uninstall")}
                variant="danger"
                onPress={() => {
                  setPublicDetail(null);
                  void uninstall(item.id, itemName);
                }}
              />
            ) : null}
            <PillButton
              label={installedVer === null ? pick("安装", "Install") : pick("重新安装", "Reinstall")}
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
          <StatusPill bg={t.brandSoft} color={t.brand} label={pick("nibi-go-market 验签", "Signed index")} />
          <StatusPill
            bg={t.surfaceSoft}
            color={t.inkSub}
            label={
              entry.package.format === "npm"
                ? "npm MCP"
                : entry.kind === "skill"
                  ? pick("技能包", "Skill pack")
                  : pick("标准 ZIP", "ZIP")
            }
          />
          {installedVer ? (
            <StatusPill
              bg={t.okSoft}
              color={t.ok}
              label={pick(`已安装 v${installedVer}`, `Installed v${installedVer}`)}
            />
          ) : null}
        </View>
        <Text style={[styles.meta, { color: t.inkFaint }]}>
          v{entry.version}
          {entry.publisher ? ` · ${entry.publisher}` : ""}
          {entry.license ? ` · ${entry.license}` : ""}
        </Text>
        <Text style={[styles.detailDesc, { color: t.ink }]}>
          {entry.description ||
            pick(
              "已通过 nibi-go-market 签名校验的公开插件。",
              "Public plugin verified via nibi-go-market signature.",
            )}
        </Text>
        <View style={styles.sheetActions}>
          {installedVer ? (
            <PillButton
              label={pick("卸载", "Uninstall")}
              variant="danger"
              onPress={() => {
                setPublicDetail(null);
                void uninstall(entry.id, entry.name);
              }}
            />
          ) : null}
          <PillButton
            label={installedVer === null ? pick("安装", "Install") : pick("重新安装", "Reinstall")}
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
          : pick(publicDetail.item.name, publicDetail.item.nameEn);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[t.glowTop, t.bgGradient[0], t.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader
        title={pick("插件市场", "Marketplace")}
        onBack={() => router.back()}
        right={
          <View style={styles.headerRightRow}>
            <PressableScale
              onPress={() => void toggleRegion()}
              disabled={refreshing}
              accessibilityRole="button"
              accessibilityLabel={pick(
                `切换镜像源，当前为${marketRegionLabel(region)}`,
                `Switch mirror source (currently ${marketRegionLabel(region)})`,
              )}
              hitSlop={6}
              style={[
                styles.regionButton,
                { backgroundColor: t.glass, borderColor: t.glassBorder },
                refreshing ? styles.busy : null,
              ]}
            >
              <Icon name="globe" size={14} color={t.brand} />
              <Text style={[styles.regionButtonText, { color: t.ink }]}>
                {region === "cn" ? pick("国内源", "CN") : pick("国外源", "Global")}
              </Text>
            </PressableScale>

            <PressableScale
              onPress={() => void doRefresh()}
              disabled={refreshing}
              accessibilityRole="button"
              accessibilityLabel={pick("刷新市场索引", "Refresh marketplace index")}
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
        contentContainerStyle={bodyStyle}
      >
        <AppearIn delay={staggerDelay(0, 28, 200)}>
          <SegmentedControl
            options={marketTabs}
            value={tab}
            onChange={setTab}
          />
        </AppearIn>

        <AppearIn delay={staggerDelay(1, 28, 200)}>
          <View style={[styles.mirrorBanner, { backgroundColor: t.card, borderColor: t.hairline }]}>
            <View style={styles.mirrorBannerTextWrap}>
              <Text style={[styles.mirrorBannerTitle, { color: t.ink }]}>
                {pick("NIBI-GO 独立市场", "NIBI-GO Marketplace")} · {marketRegionLabel(region)}
              </Text>
              <Text style={[styles.mirrorBannerSub, { color: t.inkFaint }]}>
                {region === "cn"
                  ? pick(
                      "目录源：nibi-go-market（jsDelivr / Fastly 验签）· npm 源：npmmirror",
                      "Index: nibi-go-market (jsDelivr/Fastly signed) · npm: npmmirror",
                    )
                  : pick(
                      "目录源：nibi-go-market（GitHub Raw 验签）· npm 源：registry.npmjs.org",
                      "Index: nibi-go-market (GitHub Raw signed) · npm: registry.npmjs.org",
                    )}
              </Text>
            </View>
            <PillButton
              label={region === "cn" ? pick("切国外源", "Global") : pick("切国内源", "CN Mirror")}
              variant="secondary"
              buttonSize="sm"
              onPress={() => void toggleRegion()}
            />
          </View>
        </AppearIn>

        {corruptSnapshot ? (
          <View style={[styles.message, { backgroundColor: t.amberSoft, borderColor: t.hairline }]}>
            <Text style={[styles.messageText, { color: t.amber }]}>
              {pick(
                "本地市场快照损坏，已忽略；刷新会重新建立快照。",
                "Local marketplace snapshot was corrupted and ignored; refresh to rebuild it.",
              )}
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
              <SectionCard
                label={pick(
                  "随包内置（手机轻量专属 · 开箱即用）",
                  "Bundled with NIBI-GO (mobile-ready)",
                )}
              >
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
                        title={pluginDisplayName(
                          manifest?.id ?? bundled.dir,
                          manifest?.name ?? bundled.dir,
                        )}
                        detail={pluginDisplayDescription(
                          manifest?.id ?? bundled.dir,
                          manifest?.description ??
                            pick(
                              "NIBI-GO 手机端轻量内置套件，支持本地 MCP 工具与快捷技能",
                              "Built-in lightweight NIBI-GO mobile suite with local MCP tools & skills",
                            ),
                        )}
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
                    {pick("NIBI 手机市场官方扩展", "Official NIBI mobile extensions")}
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
                      placeholder={pick(
                        `搜 ${region === "cn" ? "npmmirror" : "npmjs"} MCP 包名或关键词`,
                        `Search ${region === "cn" ? "npmmirror" : "npmjs"} MCP packages or keywords`,
                      )}
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
                        accessibilityLabel={pick("清空搜索词", "Clear search")}
                      >
                        <Icon name="x" size={14} color={t.inkFaint} />
                      </PressableScale>
                    ) : null}
                  </View>
                  <PillButton
                    label={npmSearching ? pick("搜索中…", "Searching…") : pick("搜索", "Search")}
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
                        const chLabel = pick(ch.label, ch.labelEn);
                        return (
                          <PressableScale
                            key={ch.id}
                            scaleTo={0.95}
                            onPress={() => setBrowseChannel(ch.id)}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={pick(`浏览频道 ${chLabel}`, `Browse ${chLabel}`)}
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
                              {chLabel}
                            </Text>
                          </PressableScale>
                        );
                      })}
                    </ScrollView>

                    <View style={styles.channelMetaRow}>
                      <Text style={[styles.channelSub, { color: t.inkFaint }]} numberOfLines={1}>
                        {pick(activeBrowseChannel.subtitle, activeBrowseChannel.subtitleEn)}
                        {activeBrowseChannel.query && currentBrowseFeed.total > 0
                          ? pick(
                              ` · ${currentBrowseFeed.total.toLocaleString()} 个包`,
                              ` · ${currentBrowseFeed.total.toLocaleString()} packages`,
                            )
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
                          accessibilityLabel={pick(
                            `刷新${activeBrowseChannel.label}`,
                            `Refresh ${activeBrowseChannel.labelEn}`,
                          )}
                          style={styles.channelRefreshBtn}
                        >
                          <Icon name="refresh" size={12} color={t.inkFaint} />
                          <Text style={[styles.channelRefreshText, { color: t.inkFaint }]}>
                            {pick("刷新", "Refresh")}
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
                    {pick(`搜索「${npmQuery.trim()}」`, `Search "${npmQuery.trim()}"`)}
                    {npmHits.length > 0
                      ? pick(
                          ` · 已展示 ${npmHits.length}${npmTotal > npmHits.length ? ` / ${npmTotal}` : ""}（${npmSearchRegistry?.replace(/^https:\/\//u, "") ?? "npm"}）`,
                          ` · ${npmHits.length}${npmTotal > npmHits.length ? ` / ${npmTotal}` : ""} (${npmSearchRegistry?.replace(/^https:\/\//u, "") ?? "npm"})`,
                        )
                      : ""}
                  </Text>
                  <PressableScale
                    onPress={clearNpmSearch}
                    accessibilityRole="button"
                    accessibilityLabel={pick("返回频道浏览", "Back to channels")}
                    style={[
                      styles.backBrowseChip,
                      { backgroundColor: t.card, borderColor: t.hairline },
                    ]}
                  >
                    <Text style={[styles.backBrowseText, { color: t.inkSub }]}>
                      {pick("返回浏览", "Browse")}
                    </Text>
                  </PressableScale>
                </View>

                {npmSearching ? (
                  <View style={styles.loading}>
                    <ActivityIndicator color={t.brand} />
                    <Text style={[styles.hint, { color: t.inkFaint }]}>
                      {pick(
                        `正在检索 ${region === "cn" ? "npmmirror" : "npmjs.org"}…`,
                        `Searching ${region === "cn" ? "npmmirror" : "npmjs.org"}…`,
                      )}
                    </Text>
                  </View>
                ) : npmSearchError ? (
                  <View style={[styles.empty, { borderColor: t.hairline, backgroundColor: t.card }]}>
                    <Text style={[styles.hint, { color: t.red }]}>{npmSearchError}</Text>
                    <View style={styles.actions}>
                      <PillButton
                        label={pick("重试", "Retry")}
                        variant="secondary"
                        buttonSize="sm"
                        onPress={() => void handleSearchNpm()}
                      />
                    </View>
                  </View>
                ) : npmHits.length === 0 ? (
                  <View style={[styles.empty, { borderColor: t.hairline, backgroundColor: t.card }]}>
                    <Text style={[styles.emptyTitle, { color: t.inkSub }]}>
                      {pick("未找到匹配的 npm 包", "No matching npm packages")}
                    </Text>
                    <Text style={[styles.hint, { color: t.inkFaint }]}>
                      {pick(
                        "可以换个英文关键词，点「返回浏览」按分类逛，或去「个人」页直接输入完整包名安装。",
                        "Try another keyword, tap Browse to explore categories, or install by exact package name under Personal.",
                      )}
                    </Text>
                  </View>
                ) : (
                  <>
                    {npmHits.map(renderNpmHitCard)}
                    {npmHasMore ? (
                      <View style={styles.loadMoreWrap}>
                        <PillButton
                          label={npmLoadingMore ? pick("加载中…", "Loading…") : pick("加载更多结果", "Load more")}
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
                  <Text style={[styles.hint, { color: t.inkFaint }]}>
                    {pick("读取公开市场目录…", "Loading public marketplace…")}
                  </Text>
                </View>
              ) : (
                <View style={styles.sectionStack}>
                  {publicRemoteEntries.length > 0 ? (
                    <>
                      <Text style={[styles.sectionHeading, { color: t.inkFaint }]}>
                        {pick(
                          "已审核公开市场（nibi-go-market 验签收录）",
                          "Verified public catalog (signed index)",
                        )}
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
                        {pick(
                          "手机实测精选 MCP（纯 JS · 点击卡片看详情）",
                          "Mobile-tested featured MCPs (pure JS · tap for details)",
                        )}
                      </Text>
                      {visibleFeaturedNpmMcps.map((item, idx) => {
                        const itemName = pick(item.name, item.nameEn);
                        const itemDesc = pick(item.description, item.descriptionEn);
                        const installedVer = versions[item.id] ?? null;
                        const isBusy = busyId === item.id;
                        const needsKey = item.needsKey;
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
                                accessibilityLabel={pick(`查看 ${itemName} 详情`, `View details for ${itemName}`)}
                                style={({ pressed }) => [
                                  styles.cardBodyTap,
                                  pressed ? { opacity: 0.78 } : null,
                                ]}
                              >
                                <View style={styles.cardHead}>
                                  <View style={styles.cardTitleWrap}>
                                    <View style={styles.titleBadgeRow}>
                                      <Text style={[styles.name, { color: t.ink }]}>{itemName}</Text>
                                      <StatusPill
                                        bg={t.brandSoft}
                                        color={t.brand}
                                        label={pick(item.category, item.categoryEn)}
                                      />
                                      <StatusPill
                                        bg={needsKey ? t.amberSoft : t.okSoft}
                                        color={needsKey ? t.amber : t.ok}
                                        label={pick(item.envHint, item.envHintEn)}
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
                                      label={pick(`已安装 v${installedVer}`, `Installed v${installedVer}`)}
                                    />
                                  )}
                                </View>
                                <Text
                                  style={[styles.description, { color: t.inkSub }]}
                                  numberOfLines={2}
                                >
                                  {itemDesc}
                                </Text>
                              </Pressable>
                              <View style={styles.actions}>
                                <PillButton
                                  label={
                                    isBusy
                                      ? pick("安装中…", "Installing…")
                                      : installedVer === null
                                        ? pick("安装", "Install")
                                        : pick("重新安装", "Reinstall")
                                  }
                                  variant="primary"
                                  buttonSize="sm"
                                  disabled={isBusy || busyId !== null}
                                  onPress={() =>
                                    void executeNpmCommunityInstall({
                                      packageName: item.packageName,
                                      displayName: itemName,
                                      description: itemDesc,
                                      origin: "npm-search",
                                    })
                                  }
                                  style={styles.primaryButton}
                                />
                                {installedVer !== null && !isBusy ? (
                                  <PillButton
                                    label={pick("卸载", "Uninstall")}
                                    variant="danger"
                                    buttonSize="sm"
                                    onPress={() => void uninstall(item.id, itemName)}
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
                    {pick("精选开源技能包（离线可用）", "Curated open-source skill packs (offline-ready)")}
                  </Text>
                  {CURATED_PUBLIC_PLUGINS.map((item, idx) => {
                    const itemName = pick(item.name, item.nameEn);
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
                            accessibilityLabel={pick(`查看 ${itemName} 详情`, `View details for ${itemName}`)}
                            style={({ pressed }) => [
                              styles.cardBodyTap,
                              pressed ? { opacity: 0.78 } : null,
                            ]}
                          >
                            <View style={styles.cardHead}>
                              <View style={styles.cardTitleWrap}>
                                <View style={styles.titleBadgeRow}>
                                  <Text style={[styles.name, { color: t.ink }]}>{itemName}</Text>
                                  <StatusPill
                                    bg={t.surfaceSoft}
                                    color={t.inkSub}
                                    label={pick("技能包", "Skill pack")}
                                  />
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
                                  label={pick(`已安装 v${installedVer}`, `Installed v${installedVer}`)}
                                />
                              )}
                            </View>
                            <Text style={[styles.description, { color: t.inkSub }]} numberOfLines={2}>
                              {pick(item.description, item.descriptionEn)}
                            </Text>
                          </Pressable>
                          <View style={styles.actions}>
                            <PillButton
                              label={
                                installedVer === null
                                  ? pick("安装", "Install")
                                  : pick("重新安装", "Reinstall")
                              }
                              variant="primary"
                              buttonSize="sm"
                              disabled={isBusy || busyId !== null}
                              onPress={() => void installCuratedPublic(item)}
                              style={styles.primaryButton}
                            />
                            {installedVer !== null && !isBusy ? (
                              <PillButton
                                label={pick("卸载", "Uninstall")}
                                variant="danger"
                                buttonSize="sm"
                                onPress={() => void uninstall(item.id, itemName)}
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
                        {pick("逛逛实时开源 MCP 生态", "Explore live open-source MCPs")}
                      </Text>
                      <Text style={[styles.mirrorBannerSub, { color: t.inkFaint }]}>
                        {pick(
                          "切换「热门 MCP / 搜索抓取 / 地图出行 / 开发数据」频道，支持无限翻页探索",
                          "Switch channels like Popular MCP, Search & Web, Maps, or Dev & Data to browse with pagination",
                        )}
                      </Text>
                    </View>
                    <PillButton
                      label={pick("去逛热门", "Explore")}
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
                  const itemName = pick(item.name, item.nameEn);
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
                        accessibilityLabel={pick(`查看 ${itemName} 详情`, `View details for ${itemName}`)}
                        style={({ pressed }) => [
                          styles.cardBodyTap,
                          pressed ? { opacity: 0.78 } : null,
                        ]}
                      >
                        <View style={styles.cardHead}>
                          <View style={styles.cardTitleWrap}>
                            <View style={styles.titleBadgeRow}>
                              <Text style={[styles.name, { color: t.ink }]}>{itemName}</Text>
                              <StatusPill
                                bg={t.surfaceSoft}
                                color={t.inkSub}
                                label={pick("技能包", "Skill pack")}
                              />
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
                              label={pick(`已安装 v${installedVer}`, `Installed v${installedVer}`)}
                            />
                          )}
                        </View>
                        <Text style={[styles.description, { color: t.inkSub }]} numberOfLines={2}>
                          {pick(item.description, item.descriptionEn)}
                        </Text>
                      </Pressable>
                      <View style={styles.actions}>
                        <PillButton
                          label={
                            installedVer === null
                              ? pick("安装", "Install")
                              : pick("重新安装", "Reinstall")
                          }
                          variant="primary"
                          buttonSize="sm"
                          disabled={isBusy || busyId !== null}
                          onPress={() => void installCuratedPublic(item)}
                          style={styles.primaryButton}
                        />
                        {installedVer !== null && !isBusy ? (
                          <PillButton
                            label={pick("卸载", "Uninstall")}
                            variant="danger"
                            buttonSize="sm"
                            onPress={() => void uninstall(item.id, itemName)}
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
                      {pick(
                        `正在从 ${region === "cn" ? "npmmirror" : "npmjs.org"} 拉取「${activeBrowseChannel.label}」…`,
                        `Loading "${activeBrowseChannel.labelEn}" from ${region === "cn" ? "npmmirror" : "npmjs.org"}…`,
                      )}
                    </Text>
                  </View>
                ) : currentBrowseFeed.error && currentBrowseFeed.hits.length === 0 ? (
                  <View style={[styles.empty, { borderColor: t.hairline, backgroundColor: t.card }]}>
                    <Text style={[styles.emptyTitle, { color: t.inkSub }]}>
                      {pick("加载频道失败", "Failed to load channel")}
                    </Text>
                    <Text style={[styles.hint, { color: t.red }]}>{currentBrowseFeed.error}</Text>
                    <View style={styles.actions}>
                      <PillButton
                        label={pick("重新加载", "Reload")}
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
                    <Text style={[styles.emptyTitle, { color: t.inkSub }]}>
                      {pick("该频道暂无条目", "No packages in this channel")}
                    </Text>
                    <Text style={[styles.hint, { color: t.inkFaint }]}>
                      {pick(
                        "可以切换上方镜像源或直接在搜索框输入关键词查找。",
                        "Try switching mirror sources above or searching by keyword.",
                      )}
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
                              ? pick("加载更多中…", "Loading more…")
                              : pick(
                                  `加载更多（已显示 ${currentBrowseFeed.hits.length} 个）`,
                                  `Load more (${currentBrowseFeed.hits.length} shown)`,
                                )
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
                        {pick(
                          `已展示本频道全部可浏览条目（源：${currentBrowseFeed.registry?.replace(/^https:\/\//u, "") ?? "npm"}）`,
                          `End of channel (${currentBrowseFeed.registry?.replace(/^https:\/\//u, "") ?? "npm"})`,
                        )}
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
              <SectionCard label={pick("添加个人插件", "Add custom plugin")}>
                <Row
                  icon="terminal"
                  tone="brand"
                  title={pick("从 npm 安装纯 JS MCP 包", "Install pure-JS MCP from npm")}
                  detail={pick(
                    "输入包名（如 @modelcontextprotocol/server-sequential-thinking），强制禁脚本并拦截原生二进制",
                    "Enter a package name (e.g. @modelcontextprotocol/server-sequential-thinking); runs with --ignore-scripts and blocks native binaries",
                  )}
                  onPress={() => setAddNpmOpen(true)}
                />
                <Divider />
                <Row
                  icon="globe"
                  tone="steel"
                  title={pick("从链接安装标准插件包 (.zip)", "Install standard archive from URL (.zip)")}
                  detail={pick(
                    "支持 GitHub Releases / Raw / jsDelivr 上的 .nibi-plugin、.claude-plugin、.codex-plugin 或纯 skills 包",
                    "Supports .nibi-plugin, .claude-plugin, .codex-plugin, or skills archives on GitHub Releases / Raw / jsDelivr",
                  )}
                  onPress={() => setAddPersonalOpen(true)}
                />
                <Divider />
                <Row
                  icon="folder"
                  tone="plain"
                  title={pick("从手机本地导入插件包 (.zip)", "Import local archive (.zip)")}
                  detail={pick(
                    "支持标准 .nibi-plugin/.claude-plugin/.codex-plugin、skills/SKILL.md 或 nibi-go.plugin.json 压缩包",
                    "Supports .nibi-plugin/.claude-plugin/.codex-plugin, skills/SKILL.md, or nibi-go.plugin.json zips",
                  )}
                  onPress={() => void handleImportLocalZip()}
                />
              </SectionCard>

              {personalSources.length > 0 ? (
                <SectionCard label={pick("已添加的个人源", "Saved custom sources")}>
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
                                label={pick("移除", "Remove")}
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
                <SectionCard label={pick("本机个人插件", "Installed custom plugins")}>
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
                            <StatusPill bg={t.okSoft} color={t.ok} label={pick("已安装", "Installed")} />
                            <PillButton
                              label={pick("卸载", "Uninstall")}
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
                    {pick("还没有添加个人插件", "No custom plugins added yet")}
                  </Text>
                  <Text style={[styles.hint, { color: t.inkFaint }]}>
                    {pick(
                      "你可以直接输入 npm 包名安装纯 JS MCP，粘贴 GitHub Releases / jsDelivr 上的标准插件包直链，或从手机本地导入 .zip 插件包。",
                      "Install a pure-JS MCP by npm package name, paste a direct archive URL from GitHub Releases / jsDelivr, or import a local .zip file.",
                    )}
                  </Text>
                </View>
              )}
            </View>
          </AppearIn>
        ) : null}

        {snapshot ? (
          <Text style={[styles.footnote, { color: t.inkGhost }]}>
            {pick("索引同步于 ", "Index synced ")}
            {formatFetchedAt(snapshot.fetchedAt)} · {marketRegionLabel(region)}
          </Text>
        ) : null}
      </ScrollView>

      {/* 添加个人 npm MCP 包 Sheet */}
      <Sheet
        visible={addNpmOpen}
        onClose={() => setAddNpmOpen(false)}
        title={pick("从 npm 安装纯 JS MCP 包", "Install pure-JS MCP from npm")}
      >
        <View style={styles.sheetForm}>
          <Text style={[styles.hint, { color: t.inkSub }]}>
            {pick(
              `支持输入 npm 包名、精确版本（如 @scope/pkg@1.0.0）或 npmjs.com 链接，将按当前所选「${marketRegionLabel(region)}」（${region === "cn" ? "npmmirror" : "npmjs.org"}）通过随包内置 npm 以 --ignore-scripts 模式隔离安装。`,
              `Enter an npm package name, exact version (e.g. @scope/pkg@1.0.0), or npmjs.com URL. Installed via built-in npm using ${marketRegionLabel(region)} (${region === "cn" ? "npmmirror" : "npmjs.org"}) with --ignore-scripts.`,
            )}
          </Text>
          <TextInput
            value={personalNpmNameInput}
            onChangeText={setPersonalNpmNameInput}
            placeholder={pick("显示名称（可选，留空自动取 npm 包名）", "Display name (optional)")}
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
              {pick(
                "我了解该 npm 包来自公共社区且未经 NIBI 官方审核，并确认在手机端禁用安装脚本的沙箱中运行。",
                "I understand this package is from the public npm community (unverified by NIBI) and will run sandboxed with install scripts disabled.",
              )}
            </Text>
          </PressableScale>
          <View style={styles.sheetActions}>
            <PillButton
              label={pick("取消", "Cancel")}
              variant="secondary"
              onPress={() => setAddNpmOpen(false)}
            />
            <PillButton
              label={addingNpm ? pick("正在安装…", "Installing…") : pick("校验并安装", "Verify & install")}
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
        title={pick("安装 npm 公共社区包", "Install community npm package")}
        message={
          pendingNpmConfirm
            ? pick(
                `「${pendingNpmConfirm.packageName}${pendingNpmConfirm.version ? `@${pendingNpmConfirm.version}` : ""}」来自 npm 公共源，未经 NIBI 官方审核。\n\n安装器将强制跳过所有安装脚本（--ignore-scripts）并拦截原生二进制文件。确认继续安装？`,
                `"${pendingNpmConfirm.packageName}${pendingNpmConfirm.version ? `@${pendingNpmConfirm.version}` : ""}" comes from the public npm registry and is not verified by NIBI.\n\nInstall scripts will be skipped (--ignore-scripts) and native binaries blocked. Continue?`,
              )
            : ""
        }
        confirmLabel={pick("确认安装", "Install")}
        cancelLabel={pick("取消", "Cancel")}
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
        title={pick("添加标准插件包地址 (.zip)", "Add plugin archive URL (.zip)")}
      >
        <View style={styles.sheetForm}>
          <Text style={[styles.hint, { color: t.inkSub }]}>
            {pick(
              `支持填写 GitHub Releases / Raw、jsDelivr 或个人服务器上的标准插件包（.nibi-plugin / .claude-plugin / .codex-plugin / skills / nibi-go.plugin.json）HTTPS 地址，下载时自动按当前「${marketRegionLabel(region)}」加速。`,
              `Enter an HTTPS URL to a standard plugin archive (.nibi-plugin / .claude-plugin / .codex-plugin / skills / nibi-go.plugin.json) on GitHub Releases, Raw, jsDelivr, or your server. Accelerated via ${marketRegionLabel(region)}.`,
            )}
          </Text>
          <TextInput
            value={personalNameInput}
            onChangeText={setPersonalNameInput}
            placeholder={pick("备注名称（可选，留空自动取插件清单名）", "Label (optional — defaults to manifest name)")}
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
              {pick(
                "我信任该插件来源，并知晓自定义插件将在本机沙箱环境中运行。",
                "I trust this source and understand custom plugins run in the local sandbox.",
              )}
            </Text>
          </PressableScale>
          <View style={styles.sheetActions}>
            <PillButton
              label={pick("取消", "Cancel")}
              variant="secondary"
              onPress={() => setAddPersonalOpen(false)}
            />
            <PillButton
              label={addingPersonal ? pick("正在安装…", "Installing…") : pick("下载并安装", "Download & install")}
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
        title={pick("需要登录 NIBI 账号", "Sign in to NIBI required")}
        message={
          loginPromptEntry
            ? pick(
                `安装「${loginPromptEntry.name}」需要先登录你的 NIBI 账号以核验可用权限。`,
                `Sign in to your NIBI account to verify access before installing "${loginPromptEntry.name}".`,
              )
            : ""
        }
        confirmLabel={pick("立即登录", "Sign in")}
        cancelLabel={pick("取消", "Cancel")}
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
