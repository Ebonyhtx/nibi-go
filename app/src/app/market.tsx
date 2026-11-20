// 插件市场：读已验签的索引快照，展示可安装/可更新插件，执行安装/更新/卸载。
//
// 索引刷新失败（网络/验签/回滚/版本不变量）会保留上一份快照并给出原因；
// 安装前校验包 sha256，解包后校验清单 id/version 与索引一致。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { comparePluginVersions, type MarketPluginEntry } from "@nibi-go/market-index";

import { Icon } from "../components/Icon";
import { installMarketPlugin, readInstalledManifest, uninstallMarketPlugin } from "../plugins/installer";
import { readMarketSnapshot, refreshMarket, type MarketSnapshotFile } from "../plugins/marketStore";
import { ensureLicenseLoaded, licenseSummary, pluginLicenseDecision } from "../plugins/license";
import { MARKET_INDEX_URL } from "../plugins/marketSource";
import { usePlugins } from "../plugins/usePlugins";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function MarketRow({
  entry,
  installedVersion,
  busy,
  paidDecision,
  onInstall,
  onUninstall,
  onCancel,
}: {
  entry: MarketPluginEntry;
  installedVersion: string | null;
  busy: boolean;
  paidDecision: { allowed: boolean; reason: string } | null;
  onInstall: () => void;
  onUninstall: () => void;
  onCancel: () => void;
}) {
  const t = useNibiTheme();
  const hasUpdate =
    installedVersion !== null && comparePluginVersions(entry.version, installedVersion) > 0;
  const blocked = paidDecision !== null && !paidDecision.allowed;
  const action = blocked ? "需会员" : installedVersion === null ? "安装" : hasUpdate ? "更新" : "重新安装";
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: t.ink }]}>{entry.name}</Text>
          <Text style={[styles.meta, { color: t.inkFaint }]}>
            {entry.id} · v{entry.version} · {formatSize(entry.package.size)}
          </Text>
        </View>
        {paidDecision !== null && blocked ? (
          <View style={[styles.badge, { backgroundColor: t.amberSoft }]}>
            <Text style={[styles.badgeText, { color: t.amber }]}>付费</Text>
          </View>
        ) : installedVersion === null ? (
          <View style={[styles.badge, { backgroundColor: t.panel }]}>
            <Text style={[styles.badgeText, { color: t.inkFaint }]}>未安装</Text>
          </View>
        ) : hasUpdate ? (
          <View style={[styles.badge, { backgroundColor: t.amberSoft }]}>
            <Text style={[styles.badgeText, { color: t.amber }]}>可更新</Text>
          </View>
        ) : (
          <View style={[styles.badge, { backgroundColor: t.okSoft }]}>
            <Text style={[styles.badgeText, { color: t.ok }]}>已安装 v{installedVersion}</Text>
          </View>
        )}
      </View>

      {entry.description ? (
        <Text style={[styles.description, { color: t.inkSub }]}>{entry.description}</Text>
      ) : null}
      {blocked ? (
        <Text style={[styles.description, { color: t.amber }]}>{paidDecision?.reason}</Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${action} ${entry.name}`}
          disabled={busy || blocked}
          onPress={onInstall}
          style={[styles.primary, { backgroundColor: t.brand, opacity: busy || blocked ? 0.5 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator color={t.brandFg} />
          ) : (
            <Text style={[styles.primaryText, { color: t.brandFg }]}>{action}</Text>
          )}
        </Pressable>
        {busy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`取消安装 ${entry.name}`}
            onPress={onCancel}
            style={[styles.secondary, { borderColor: t.hairline }]}
          >
            <Text style={[styles.secondaryText, { color: t.inkSub }]}>取消</Text>
          </Pressable>
        ) : null}
        {installedVersion !== null && !busy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`卸载 ${entry.name}`}
            disabled={busy}
            onPress={onUninstall}
            style={[styles.secondary, { borderColor: t.hairline }]}
          >
            <Text style={[styles.secondaryText, { color: t.red }]}>卸载</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function MarketScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const plugins = usePlugins();
  const [snapshot, setSnapshot] = useState<MarketSnapshotFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, string | null>>({});
  const [license, setLicense] = useState(licenseSummary());
  const [corruptSnapshot, setCorruptSnapshot] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const readVersions = useCallback((entries: MarketPluginEntry[]) => {
    const next: Record<string, string | null> = {};
    for (const entry of entries) next[entry.id] = readInstalledManifest(entry.id)?.version ?? null;
    setVersions(next);
  }, []);

  const loadLocal = useCallback(async () => {
    await ensureLicenseLoaded();
    setLicense(licenseSummary());
    const { snapshot: local, corrupt } = await readMarketSnapshot();
    setCorruptSnapshot(corrupt);
    setSnapshot(local);
    if (local) readVersions(local.index.plugins);
    setLoading(false);
    return local;
  }, [readVersions]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadLocal().then((local) => {
        if (alive && local === null) void doRefresh(true);
      });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadLocal]),
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
    setMessage(`正在下载并校验 ${entry.name} v${entry.version}…`);
    try {
      const outcome = await installMarketPlugin(entry, { signal: controller.signal });
      if (!outcome.ok) {
        setMessage(`${entry.name} 安装失败：${outcome.reason}`);
        return;
      }
      setVersions((current) => ({ ...current, [entry.id]: outcome.manifest.version }));
      await plugins.reload();
      setMessage(`${entry.name} v${outcome.manifest.version} 已安装`);
    } finally {
      abortRef.current = null;
      setBusyId(null);
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

  const entries = snapshot?.index.plugins ?? [];

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={[styles.head, { borderBottomColor: t.hairline }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          style={[styles.back, { backgroundColor: t.panel }]}
        >
          <Icon name="chevron-left" size={16} color={t.inkSub} />
        </Pressable>
        <Text style={[styles.title, { color: t.ink }]}>插件市场</Text>
        <Pressable
          onPress={() => void doRefresh()}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel="刷新市场索引"
          style={[styles.back, { backgroundColor: t.panel, opacity: refreshing ? 0.5 : 1 }]}
        >
          {refreshing ? (
            <ActivityIndicator color={t.brand} />
          ) : (
            <Icon name="refresh" size={16} color={t.inkSub} />
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <Text style={[styles.hint, { color: t.inkFaint }]}>
          索引经 Ed25519 验签，包按 sha256 校验；刷新失败会保留上一份快照。
        </Text>
        <Text style={[styles.source, { color: t.inkGhost }]} numberOfLines={1}>
          {MARKET_INDEX_URL}
        </Text>
        <Text style={[styles.hint, { color: license.activated ? t.inkFaint : t.amber }]}>
          {license.activated
            ? `付费授权已激活${license.expiresAt ? `（至 ${license.expiresAt.slice(0, 10)}）` : ""}`
            : `付费授权：${license.reason}`}
        </Text>

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

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={t.brand} />
            <Text style={[styles.hint, { color: t.inkFaint }]}>读取市场快照…</Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={[styles.empty, { borderColor: t.hairline }]}>
            <Text style={[styles.emptyTitle, { color: t.inkSub }]}>市场里还没有插件</Text>
            <Text style={[styles.hint, { color: t.inkFaint }]}>
              官方索引当前为空。点右上角刷新；发布新索引后这里会出现条目。
            </Text>
          </View>
        ) : (
          entries.map((entry) => (
            <MarketRow
              key={entry.id}
              entry={entry}
              installedVersion={versions[entry.id] ?? null}
              busy={busyId === entry.id}
              paidDecision={entry.paid ? pluginLicenseDecision(entry.id) : null}
              onInstall={() => void install(entry)}
              onUninstall={() => void uninstall(entry)}
              onCancel={cancelInstall}
            />
          ))
        )}

        {snapshot ? (
          <Text style={[styles.footnote, { color: t.inkGhost }]}>
            revision {snapshot.state.revision} · 拉取于 {snapshot.fetchedAt}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, textAlign: "center", fontSize: typeScale.heading, fontWeight: "700" },
  body: { padding: space(4), gap: space(3) },
  hint: { fontSize: 12, lineHeight: 18 },
  source: { fontSize: 10.5, lineHeight: 15 },
  message: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: space(3) },
  messageText: { fontSize: 12, lineHeight: 18 },
  loading: { alignItems: "center", gap: space(2), paddingVertical: space(6) },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(4),
    gap: space(2),
  },
  emptyTitle: { fontSize: 13, fontWeight: "700" },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
    gap: space(2),
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: space(2) },
  name: { fontSize: 14, fontWeight: "700" },
  meta: { fontSize: 11, marginTop: 2 },
  description: { fontSize: 12, lineHeight: 18 },
  badge: { borderRadius: 999, paddingHorizontal: space(2), paddingVertical: 3 },
  badgeText: { fontSize: 10.5, fontWeight: "700" },
  actions: { flexDirection: "row", gap: space(2), marginTop: space(1) },
  primary: {
    borderRadius: 999,
    paddingHorizontal: space(4),
    paddingVertical: space(1.5),
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontSize: 12.5, fontWeight: "700" },
  secondary: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: space(4),
    paddingVertical: space(1.5),
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 12.5, fontWeight: "700" },
  footnote: { fontSize: 10.5, marginTop: space(2) },
});
