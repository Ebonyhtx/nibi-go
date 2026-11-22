// 插件 Web Island：在受控 WebView 里渲染插件的网页面板。
//
// 约束：url 只允许 https（契约层已校验）；导航只允许当前页面/同源，外部链接一律拦下。
// 加载超时（8s）或失败时显示可重试的降级页，不把 WebView 的错误冒到会话里。

import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { Icon } from "../components/Icon";
import { PressableScale } from "../motion/PressableScale";
import { usePlugins } from "../plugins/usePlugins";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

const LOAD_TIMEOUT_MS = 8_000;

export default function WebIslandScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ pluginId?: string; islandId?: string }>();
  const plugins = usePlugins();
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const plugin = plugins.plugins.find(
    (entry) => entry.parsed.manifest.id === params.pluginId,
  );
  const island = plugin?.parsed.manifest.contributes.webIslands.find(
    (entry) => entry.id === params.islandId,
  );

  useEffect(() => {
    if (!island || loaded) return;
    const timer = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [island, loaded, reloadKey]);

  const retry = () => {
    setLoaded(false);
    setTimedOut(false);
    setFailed(false);
    setReloadKey((value) => value + 1);
  };

  const header = (title: string, subtitle?: string) => (
    <View style={[styles.header, { paddingTop: insets.top + space(1) }]}>
      <PressableScale
        scaleTo={0.95}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="返回"
        style={({ pressed }) => [
          styles.back,
          { backgroundColor: pressed ? t.hover : t.card, borderColor: t.hairline },
        ]}
      >
        <Icon name="chevron-left" size={17} color={t.ink} />
      </PressableScale>
      <View style={styles.headerText}>
        <Text style={[styles.title, { color: t.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: t.inkFaint }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!plugin || !island) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg }]}>
        {header("网页面板不可用")}
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: t.inkSub }]}>
            {plugins.loading ? "正在读取插件…" : "插件不存在，或这个网页面板已被移除。"}
          </Text>
        </View>
      </View>
    );
  }

  const disabledReason = !plugin.parsed.slotsAvailable
    ? plugin.parsed.reason ?? "插件槽不可用"
    : !plugin.enabled
      ? "插件已停用，在插件中心启用后再打开。"
      : plugin.parsed.status !== "ready"
        ? plugin.parsed.reason ?? "插件清单不兼容"
        : null;

  const allowedOrigin = island.url ? safeOrigin(island.url) : null;
  const canNavigate = (url: string): boolean => {
    if (island.html) return url.startsWith("about:");
    if (!allowedOrigin) return false;
    return safeOrigin(url) === allowedOrigin;
  };

  const source = island.html ? { html: island.html } : { uri: island.url as string };
  const fallback = timedOut ? "网页面板加载超时" : "网页面板加载失败";

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {header(island.title, `${plugin.parsed.manifest.name} · Web Island`)}
      <View style={[styles.content, { paddingBottom: insets.bottom + space(3) }]}>
        {disabledReason ? (
          <View style={[styles.banner, { backgroundColor: t.panel }]}>
            <Text style={[styles.bannerText, { color: t.inkSub }]}>{disabledReason}</Text>
          </View>
        ) : timedOut || failed ? (
          <View style={[styles.fallback, { backgroundColor: t.card, borderColor: t.hairline }]}>
            <Text style={[styles.fallbackTitle, { color: t.ink }]}>{fallback}</Text>
            <Text style={[styles.fallbackText, { color: t.inkFaint }]}>
              WebView 没有在预期时间内完成；可以重试，或返回插件中心。
            </Text>
            <PressableScale
              scaleTo={0.95}
              onPress={retry}
              accessibilityRole="button"
              accessibilityLabel="重试"
              style={({ pressed }) => [
                styles.retry,
                { backgroundColor: t.brand, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.retryText, { color: t.brandFg }]}>重试</Text>
            </PressableScale>
          </View>
        ) : (
          <View style={[styles.webContainer, { borderColor: t.hairline, backgroundColor: t.card }]}>
            <WebView
              key={reloadKey}
              source={source}
              originWhitelist={["about:blank", "https://*"]}
              javaScriptEnabled
              domStorageEnabled={false}
              mixedContentMode="never"
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures={false}
              onShouldStartLoadWithRequest={(request) => canNavigate(request.url)}
              onLoadEnd={() => setLoaded(true)}
              onError={() => {
                setFailed(true);
                setLoaded(true);
              }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loading}>
                  <ActivityIndicator color={t.brand} />
                </View>
              )}
              style={styles.web}
            />
          </View>
        )}
        <Text style={[styles.footnote, { color: t.inkGhost }]}>
          网页面板由插件声明；宿主只允许当前页面/同源 https 导航，加载失败会降级。
        </Text>
      </View>
    </View>
  );
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    paddingHorizontal: space(4),
    paddingBottom: space(2),
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1, gap: 1 },
  title: { fontSize: typeScale.title, fontWeight: "700" },
  subtitle: { fontSize: typeScale.micro },
  content: { flex: 1, paddingHorizontal: space(4), paddingTop: space(2), gap: space(2) },
  webContainer: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  web: { flex: 1, backgroundColor: "transparent" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  banner: { borderRadius: radius.control, padding: space(3) },
  bannerText: { fontSize: 12, lineHeight: 17 },
  fallback: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(5),
    gap: space(2),
    alignItems: "flex-start",
  },
  fallbackTitle: { fontSize: 15, fontWeight: "700" },
  fallbackText: { fontSize: 12, lineHeight: 17 },
  retry: {
    marginTop: space(2),
    borderRadius: radius.chip,
    paddingHorizontal: space(5),
    paddingVertical: space(2),
  },
  retryText: { fontSize: 13, fontWeight: "700" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(6) },
  emptyText: { fontSize: typeScale.small, textAlign: "center" },
  footnote: { fontSize: 10.5, lineHeight: 15, paddingTop: space(1) },
});