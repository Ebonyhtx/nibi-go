// 插件市场：读已验签的索引快照，展示可安装/可更新插件，执行安装/更新/卸载。
//
// 索引刷新失败（网络/验签/回滚/版本不变量）会保留上一份快照并给出原因；
// 安装前校验包 sha256，解包后校验清单 id/version 与索引一致。
// 2.0：ScreenHeader（右槽=刷新）；账号/授权卡改 SectionCard + Row；
// 安装/更新/卸载统一 PillButton（primary=安装/更新，danger=卸载）；进度条 token 化。
// 「同步」按钮必须保留 onLongPress 调试入口（授权状态模拟），所以不换成 PillButton。

import { router, useFocusEffect } from "expo-router";
import { Fragment, useCallback, useRef, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { comparePluginVersions, type MarketPluginEntry } from "@nibi-go/market-index";

import { Icon } from "../components/Icon";
import { PillButton } from "../components/ui/PillButton";
import { Row } from "../components/ui/Row";
import { Divider, SectionCard } from "../components/ui/SectionCard";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { installMarketPlugin, readInstalledManifest, uninstallMarketPlugin } from "../plugins/installer";
import { readMarketSnapshot, refreshMarket, type MarketSnapshotFile } from "../plugins/marketStore";
import {
  currentLicenseToken,
  debugClearLicenseSim,
  debugLicenseSimActive,
  debugSimulateLastCheckAge,
  ensureLicenseLoaded,
  licenseNeedsSync,
  licenseSnapshot,
  licenseSummary,
  pluginLicenseDecision,
} from "../plugins/license";
import { syncLicense } from "../plugins/licenseSync";
import { usePlugins } from "../plugins/usePlugins";
import { useSession } from "../relay/useSession";
import { AppearIn, staggerDelay } from "../motion/appear";
import { PressableScale } from "../motion/PressableScale";
import { radius, size, space, text, useNibiTheme } from "../theme";

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

/** 服务端拒绝原因 → 用户能执行下一步的中文；登录态与会员是两件事，不能混成“需会员”。 */
function describeLicenseRefusal(reason: string | null, detail?: string | null): string {
  switch (reason) {
    case "no_membership":
      return "账号已登录，但这个账号还没有开通 NIBI 会员；付费插件需要会员授权。";
    case "membership_expired":
      return "NIBI 会员已到期，续费后同步即可。";
    case "device_limit":
      return detail ?? "这个账号绑定的设备数已达上限，请先在用户中心移除不用的设备。";
    case "device_mismatch":
      return "本机授权与设备不匹配，请重新登录并同步授权。";
    case "account_mismatch":
      return "本机授权属于另一个 NIBI 账号，请重新登录并同步授权。";
    case "activation_revoked":
      return "这台设备的激活已被撤销，请重新登录或联系支持。";
    case "not_entitled":
      return "当前会员不包含这个插件。";
    case "http_401":
      return "登录已过期，请重新登录。";
    default:
      return detail ?? (reason ? `服务端拒绝：${reason}` : "本机还没有同步付费授权");
  }
}

/** 状态徽标：soft 底 + 对应色文字（付费/未安装/可更新/已安装/已下架 统一走这一处）。 */
function StatusPill({ bg, color, label }: { bg: string; color: string; label: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

/** ISO 时间戳 → 本地「YYYY-MM-DD HH:mm」（原样 ISO 串不友好，2.0.1 审查）。 */
function formatFetchedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function MarketRow({
  entry,
  installedVersion,
  busy,
  paidDecision,
  blockedReason,
  accessLabel,
  onResolveAccess,
  onInstall,
  onUninstall,
  onCancel,
}: {
  entry: MarketPluginEntry;
  installedVersion: string | null;
  busy: boolean;
  paidDecision: { allowed: boolean; reason: string } | null;
  blockedReason?: string;
  accessLabel: string;
  onResolveAccess: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  onCancel: () => void;
}) {
  const t = useNibiTheme();
  const hasUpdate =
    installedVersion !== null && comparePluginVersions(entry.version, installedVersion) > 0;
  const blocked = paidDecision !== null && !paidDecision.allowed;
  const action = blocked ? accessLabel : installedVersion === null ? "安装" : hasUpdate ? "更新" : "重新安装";
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleWrap}>
          <Text style={[styles.name, { color: t.ink }]}>{entry.name}</Text>
          {/* 2.0.1：包 id 与体积是实现细节（id 归属校验在安装时自动做），meta 只留版本。 */}
          <Text style={[styles.meta, { color: t.inkFaint }]}>v{entry.version}</Text>
        </View>
        {paidDecision !== null && blocked ? (
          <StatusPill bg={t.amberSoft} color={t.amber} label="付费" />
        ) : installedVersion === null ? (
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
      {blocked ? (
        <Text style={[styles.description, { color: t.amber }]}>
          {blockedReason ?? paidDecision?.reason}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <PillButton
          label={action}
          variant="primary"
          disabled={busy}
          onPress={blocked ? onResolveAccess : onInstall}
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
  const [snapshot, setSnapshot] = useState<MarketSnapshotFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, string | null>>({});
  const [license, setLicense] = useState(licenseSummary());
  const [refusal, setRefusal] = useState<string | null>(licenseSnapshot().lastRefusal);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [hasLicenseToken, setHasLicenseToken] = useState(currentLicenseToken() !== null);
  const [corruptSnapshot, setCorruptSnapshot] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const syncingRef = useRef(false);
  const autoSyncAt = useRef(0);

  const readVersions = useCallback((entries: MarketPluginEntry[]) => {
    const next: Record<string, string | null> = {};
    for (const entry of entries) next[entry.id] = readInstalledManifest(entry.id)?.version ?? null;
    setVersions(next);
  }, []);

  const loadLocal = useCallback(async () => {
    await ensureLicenseLoaded();
    setLicense(licenseSummary());
    setRefusal(licenseSnapshot().lastRefusal);
    setHasLicenseToken(currentLicenseToken() !== null);
    const { snapshot: local, corrupt } = await readMarketSnapshot();
    setCorruptSnapshot(corrupt);
    setSnapshot(local);
    if (local) readVersions(local.index.plugins);
    setLoading(false);
    return local;
  }, [readVersions]);

  /**
   * 进入市场时静默换证：原生已登录或本机已有 license 才发请求；10 分钟节流，
   * 先用本地快照渲染，失败不打断浏览（与桌面启动检查同口径）。
   */
  const autoSync = useCallback(async () => {
    if (syncingRef.current) return;
    if (!sessionSnapshot.loggedIn && !currentLicenseToken()) return;
    if (debugLicenseSimActive()) return; // 模拟宽限/过期期间不自动同步（一同步模拟就失效）。
    if (!licenseNeedsSync()) return;
    if (Date.now() - autoSyncAt.current < 60_000) return;
    autoSyncAt.current = Date.now();
    syncingRef.current = true;
    setSyncing(true);
    try {
      const outcome = await syncLicense();
      setLicense(licenseSummary());
      setRefusal(licenseSnapshot().lastRefusal);
      setHasLicenseToken(currentLicenseToken() !== null);
      if (outcome.ok) {
        setUpgradeUrl(outcome.authorized ? null : (outcome.upgradeUrl ?? null));
      }
    } catch {
      // 自动检查失败保留上一次结果；用户可手动点「同步」重试。
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [sessionSnapshot.loggedIn]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadLocal().then((local) => {
        if (!alive) return;
        if (local === null) void doRefresh(true);
        void autoSync();
      });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadLocal, autoSync]),
  );

  async function doRefresh(quiet = false) {
    if (refreshing) return;
    setRefreshing(true);
    if (!quiet) setMessage(null);
    try {
      const { result, snapshot: fresh } = await refreshMarket();
      if (!result.ok) {
        setMessage(describeFailure(result.kind, "detail" in result ? (result.detail ?? "") : ""));
        return;
      }
      if (fresh) {
        setSnapshot(fresh);
        readVersions(fresh.index.plugins);
        setMessage(result.kind === "unchanged" ? "已是最新索引" : null);
      } else {
        setMessage("已是最新索引");
      }
    } catch (error) {
      setMessage(`刷新失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRefreshing(false);
    }
  }

  async function install(entry: MarketPluginEntry) {
    if (busyId) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusyId(entry.id);
    setProgress({ loaded: 0, total: entry.package.size });
    setMessage(`正在下载并校验 ${entry.name} v${entry.version}…`);
    try {
      const outcome = await installMarketPlugin(entry, {
        signal: controller.signal,
        onProgress: (loaded, total) => setProgress({ loaded, total: total ?? entry.package.size }),
      });
      if (!outcome.ok) {
        setMessage(`${entry.name} 安装失败：${outcome.reason}${outcome.reason === "已取消" ? "" : "（可重试）"}`);
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

  function cancelInstall() {
    abortRef.current?.abort();
  }

  async function uninstall(entry: MarketPluginEntry) {
    const removed = await uninstallMarketPlugin(entry.id);
    setVersions((current) => ({ ...current, [entry.id]: null }));
    void plugins.reload();
    setMessage(removed ? `${entry.name} 已卸载` : "没有可卸载的目录");
  }

  // 本地已装、但已不在索引里的插件（被市场撤回）；只允许卸载，不提供更新。
  async function uninstallDelisted(dir: string, name: string) {
    const removed = await uninstallMarketPlugin(dir);
    await plugins.reload();
    setMessage(removed ? `${name} 已卸载` : "没有可卸载的目录");
  }

  async function doSync() {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setMessage(null);
    try {
      const outcome = await syncLicense();
      setLicense(licenseSummary());
      setRefusal(licenseSnapshot().lastRefusal);
      setHasLicenseToken(currentLicenseToken() !== null);
      if (outcome.ok) {
        if (outcome.authorized) {
          setUpgradeUrl(null);
          setMessage(`授权已同步${outcome.plan ? `（${outcome.plan}）` : ""}`);
        } else {
          setUpgradeUrl(outcome.upgradeUrl ?? null);
          setMessage(describeLicenseRefusal(outcome.reason, outcome.detail));
        }
      } else {
        setMessage(
          outcome.kind === "login-required"
            ? "还没有登录 NIBI 账号。登录后会自动同步本机授权。"
            : `同步失败：${outcome.detail}`,
        );
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  /**
   * 【仅调试构建】授权状态模拟入口（长按「同步」）：回拨 lastCheckAt 现场验证
   * 宽限/过期文案与安装门禁；退出模拟后手动同步一次即恢复真实状态。
   */
  const showLicenseDebugMenu = () => {
    if (!__DEV__) return;
    const apply = (days: number) => {
      void debugSimulateLastCheckAge(days).then(() => {
        setLicense(licenseSummary());
        setRefusal(licenseSnapshot().lastRefusal);
        setMessage(`已模拟 lastCheckAt 回拨 ${days} 天（自动同步已暂停）`);
      });
    };
    Alert.alert(
      "授权状态模拟（仅调试）",
      "回拨本机 lastCheckAt 验证宽限/过期状态；模拟期间不自动同步，退出后重新同步即恢复。",
      [
        { text: "模拟 4 天未检查（宽限）", onPress: () => apply(4) },
        { text: "模拟 8 天未检查（过期）", onPress: () => apply(8) },
        {
          text: "退出模拟（恢复真实状态）",
          onPress: () => {
            void debugClearLicenseSim().then(() => {
              setLicense(licenseSummary());
              setRefusal(licenseSnapshot().lastRefusal);
              setMessage("已退出模拟，点「同步」刷新真实授权。");
            });
          },
        },
        { text: "取消", style: "cancel" },
      ],
    );
  };

  /** 原生账号登录（与 WORK 网页会话是两套；登录成功立刻换证）。 */
  async function doLogin() {
    if (loggingIn) return;
    setLoggingIn(true);
    setMessage(null);
    try {
      await session.login();
      const current = session.getSnapshot();
      if (!current.loggedIn) {
        setMessage(current.error?.message ?? "登录没有完成，请重试");
        return;
      }
      await doSync();
    } finally {
      setLoggingIn(false);
    }
  }

  /**
   * 付费行的主按钮：未登录 → 登录；服务端明确说没会员/已到期且有购买页 → 打开购买页；
   * 其余情况 → 同步。安装本身仍由 installer 的 fail-closed 门禁兜底。
   */
  async function resolveAccess() {
    if (!sessionSnapshot.loggedIn) {
      await doLogin();
      return;
    }
    if (
      (refusal === "no_membership" || refusal === "membership_expired") &&
      upgradeUrl
    ) {
      try {
        await Linking.openURL(upgradeUrl);
      } catch {
        setMessage("无法打开会员页面，请手动打开官网后重试。");
      }
      return;
    }
    await doSync();
  }

  const entries = snapshot?.index.plugins ?? [];
  const delisted = snapshot
    ? plugins.plugins.filter(
        (plugin) =>
          !plugin.bundled && !entries.some((entry) => entry.id === plugin.parsed.manifest.id),
      )
    : [];

  const accountText = sessionSnapshot.loggedIn
    ? `已登录${sessionSnapshot.displayName ? `：${sessionSnapshot.displayName}` : ""}`
    : "未登录 NIBI 账号";
  const licenseText = license.activated
    ? `付费授权${license.grace ? "处于离线宽限期" : "已激活"}${
        license.plan ? `（${license.plan}）` : ""
      }${license.expiresAt ? `，至 ${license.expiresAt.slice(0, 10)}` : ""}`
    : `付费授权：${license.reason}`;
  const blockedReason = !hasLicenseToken
    ? sessionSnapshot.loggedIn
      ? "已登录，本机授权尚未同步。"
      : "未登录 NIBI 账号，本机还没有付费授权。手机远控的网页登录只用于远控，不会自动给这台手机发授权。"
    : refusal
      ? describeLicenseRefusal(refusal)
      : undefined;
  const accessLabel =
    !sessionSnapshot.loggedIn
      ? "登录账号"
      : (refusal === "no_membership" || refusal === "membership_expired") && upgradeUrl
        ? "开通会员"
        : "同步授权";

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
          // 头部右槽刷新：与 ScreenHeader 返回钮同一档玻璃圆钮。
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
        }
      />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        {/* 2.0.1：删页顶的验签/URL 两行——校验是本 app 对每个包自动做的事，用户无需决策。 */}

        <AppearIn delay={staggerDelay(1, 32, 240)}>
          <SectionCard label="账号与授权">
            <Row
              icon="user"
              tone={sessionSnapshot.loggedIn ? "steel" : "plain"}
              title={accountText}
              right={
                // onLongPress 挂调试入口（授权状态模拟），必须保留长按——不能用 PillButton。
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={sessionSnapshot.loggedIn ? "同步付费授权" : "登录 NIBI 账号"}
                  disabled={syncing || loggingIn}
                  onPress={() => void (sessionSnapshot.loggedIn ? doSync() : doLogin())}
                  onLongPress={showLicenseDebugMenu}
                  style={[
                    styles.syncButton,
                    { backgroundColor: t.surfaceSoft },
                    syncing || loggingIn ? styles.busy : null,
                  ]}
                >
                  {syncing || loggingIn ? (
                    <ActivityIndicator color={t.brand} size="small" />
                  ) : (
                    <Text style={[styles.syncText, { color: t.inkSub }]}>
                      {sessionSnapshot.loggedIn ? "同步" : "登录"}
                    </Text>
                  )}
                </PressableScale>
              }
            />
            <View style={styles.licenseBody}>
              {/* 长句不用 amber：橙字 on 白 ≈2.6:1 不可读（2.0.1 审查）；强调留给「付费」徽标与按钮。 */}
              <Text style={[styles.licenseText, { color: license.activated ? t.inkFaint : t.ink }]}>
                {licenseText}
              </Text>
              {!sessionSnapshot.loggedIn ? (
                <Text style={[styles.licenseHint, { color: t.inkGhost }]}>
                  在本应用内登录并同步一次。
                </Text>
              ) : null}
            </View>
          </SectionCard>
        </AppearIn>

        {corruptSnapshot ? (
          <AppearIn delay={staggerDelay(2, 32, 240)}>
            <View style={[styles.message, { backgroundColor: t.amberSoft, borderColor: t.hairline }]}>
              <Text style={[styles.messageText, { color: t.amber }]}>
                本地市场快照损坏，已忽略；刷新会重新建立快照。
              </Text>
            </View>
          </AppearIn>
        ) : null}

        {message ? (
          <AppearIn delay={staggerDelay(2, 32, 240)}>
            <View style={[styles.message, { backgroundColor: t.panel, borderColor: t.hairline }]}>
              <Text style={[styles.messageText, { color: t.inkSub }]}>{message}</Text>
            </View>
          </AppearIn>
        ) : null}

        {busyId && progress ? (
          <AppearIn delay={staggerDelay(2, 32, 240)}>
            <View style={styles.progressWrap}>
              <View style={[styles.progressTrack, { backgroundColor: t.surfaceSoft }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: t.brand,
                      width: `${Math.max(4, Math.min(100, Math.round((progress.loaded * 100) / (progress.total || 1))))}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.progressText, { color: t.inkFaint }]}>
                {Math.min(100, Math.round((progress.loaded * 100) / (progress.total || 1)))}%
              </Text>
            </View>
          </AppearIn>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={t.brand} />
            <Text style={[styles.hint, { color: t.inkFaint }]}>读取市场快照…</Text>
          </View>
        ) : entries.length === 0 ? (
          <AppearIn delay={staggerDelay(3, 32, 240)}>
            <View style={[styles.empty, { borderColor: t.hairline }]}>
              <Text style={[styles.emptyTitle, { color: t.inkSub }]}>市场里还没有插件</Text>
              <Text style={[styles.hint, { color: t.inkFaint }]}>点右上角刷新</Text>
            </View>
          </AppearIn>
        ) : (
          entries.map((entry, entryIndex) => (
            <AppearIn key={entry.id} delay={staggerDelay(entryIndex + 3, 32, 240)}>
              <MarketRow
                entry={entry}
                installedVersion={versions[entry.id] ?? null}
                busy={busyId === entry.id}
                paidDecision={entry.paid ? pluginLicenseDecision(entry.id) : null}
                blockedReason={blockedReason}
                accessLabel={accessLabel}
                onResolveAccess={() => void resolveAccess()}
                onInstall={() => void install(entry)}
                onUninstall={() => void uninstall(entry)}
                onCancel={cancelInstall}
              />
            </AppearIn>
          ))
        )}

        {snapshot ? (
          <Text style={[styles.footnote, { color: t.inkGhost }]}>
            更新于 {formatFetchedAt(snapshot.fetchedAt)}
          </Text>
        ) : null}

        {delisted.length > 0 ? (
          <AppearIn delay={staggerDelay(entries.length + 3, 32, 240)}>
            <SectionCard label="已下架">
              <View style={styles.delistedIntro}>
                <Text style={[styles.hint, { color: t.inkFaint }]}>
                  这些插件还装在本地，但已从市场索引撤回：不会再收到更新，也可能不再安全。
                  本地副本不会被远程删除，需要时在这里卸载。
                </Text>
              </View>
              {delisted.map((plugin, pluginIndex) => (
                <Fragment key={plugin.dir}>
                  {pluginIndex > 0 ? <Divider /> : null}
                  <Row
                    icon="puzzle"
                    tone="plain"
                    title={plugin.parsed.manifest.name}
                    detail={`${plugin.parsed.manifest.id} · v${plugin.parsed.manifest.version}`}
                    right={
                      <View style={styles.rowRight}>
                        <StatusPill bg={t.amberSoft} color={t.amber} label="已下架" />
                        <PillButton
                          label="卸载"
                          variant="danger"
                          onPress={() =>
                            void uninstallDelisted(plugin.dir, plugin.parsed.manifest.name)
                          }
                          accessibilityLabel={`卸载 ${plugin.parsed.manifest.name}`}
                        />
                      </View>
                    }
                  />
                </Fragment>
              ))}
            </SectionCard>
          </AppearIn>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  hint: { ...text("small") },
  source: { ...text("micro"), marginTop: space(0.5) },
  licenseBody: {
    paddingHorizontal: space(3.5),
    paddingBottom: space(2.5),
    gap: space(1),
  },
  licenseText: { ...text("small") },
  licenseHint: { ...text("micro") },
  syncButton: {
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
    minWidth: space(14),
    minHeight: size.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  syncText: { ...text("small"), fontWeight: "700" },
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
    gap: space(2),
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
  delistedIntro: { paddingHorizontal: space(3.5), paddingVertical: space(2) },
});
