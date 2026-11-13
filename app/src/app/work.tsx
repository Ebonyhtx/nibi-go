// WORK 形态 = 同源 WebView 载体（D4 修订：直接承载 PWA/桌面同源 UI，原生不自绘远控屏）。
//
// 这里只做「壳」：
//   · 加载 `{endpointOrigin}/remote/v4`（见 relay/workUrl.ts），页面就是线上 PWA 本体——
//     登录卡、选择电脑、桌面主体、任务会话全部同源，视觉与桌面一致
//   · 加载/失败/重试三态、系统返回键的页面优先语义、安全区
//   · WebView 内的登录用系统浏览器之外的**页内 OAuth**（同源回调），cookie 与
//     localStorage 留在 WebView 里，所以「登录一次，之后直接进设备列表」
//
// 还没接的（等上游票据 T7）：把连接所有权交给原生（E2E 密文 + 后台通知/保活）。
// 届时在这里注入 `externalWebRemoteControlProxy` 等价桥（injectedJavaScriptBeforeContentLoaded），
// 现在留了明确的注入口注释，不提前伪造接口。
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  WebView as RawWebView,
  type WebViewNavigation,
  type WebViewProps,
} from "react-native-webview";

import { Icon } from "../components/Icon";
import { ENDPOINT_ORIGIN } from "../relay/config";
import { resolveWorkUrl } from "../relay/workUrl";
import { radius, space, type as t, useNibiTheme } from "../theme";

/**
 * react-native-webview 14 的 d.ts 有泛型缺陷：`class WebView<P = undefined> extends
 * Component<WebViewProps & P>` → `WebViewProps & undefined` 塌成 never，JSX 报
 * "No overload matches (props: never)"。这里只做类型适配，运行时仍是原组件。
 */
interface WebViewHandle {
  goBack(): void;
  injectJavaScript(script: string): void;
}
const WebView = RawWebView as unknown as React.ForwardRefExoticComponent<
  WebViewProps & React.RefAttributes<WebViewHandle>
>;

type Phase = "loading" | "ready" | "failed";

/** 载体地址（构建期可用 EXPO_PUBLIC_NIBI_WORK_URL 覆盖）。 */
const WORK_URL = resolveWorkUrl(ENDPOINT_ORIGIN);

/**
 * 文档加载前注入：把 WebView 的语言钉成与 App 一致的中文。
 * 不注入时站点按 WebView 的 Accept-Language 判成 en-US，界面变英文——与桌面/官网
 * 的中文体验不一致（2026-11-13 模拟器实拍：登录卡显示 "Sign In To Continue"）。
 * navigator.language 是只读属性，用 defineProperty 覆写；同时设 document lang。
 */
const LOCALE_BOOTSTRAP = `
(() => {
  try {
    const L = 'zh-CN';
    Object.defineProperty(navigator, 'language', { get: () => L, configurable: true });
    Object.defineProperty(navigator, 'languages', { get: () => [L, 'zh'], configurable: true });
    document.documentElement.lang = L;
  } catch {}
})();
true;
`;

export default function WorkScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebViewHandle>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string>();

  // 系统返回：先给页面一次机会（它可能开着 sheet/抽屉），再走 WebView 历史，最后才退出载体。
  // 与 dsh-Go 的 web_back 语义一致（页面优先 → 历史 → 离开）。
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      let handled = false;
      webRef.current?.injectJavaScript(
        "window.__nibiAppBack && window.__nibiAppBack() ? true : false; true;",
      );
      if (canGoBack) {
        webRef.current?.goBack();
        handled = true;
      }
      if (!handled) {
        router.back();
        handled = true;
      }
      return handled;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const onNavChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  }, []);

  const retry = () => {
    setError(undefined);
    setPhase("loading");
    setProgress(0);
    setReloadKey((k) => k + 1);
  };

  return (
    <View style={[styles.root, { backgroundColor: th.bg }]}>
      {/* 薄顶栏：页面自己有完整 UI，这里只提供壳能力（返回 / 刷新 / 关闭） */}
      <View style={[styles.bar, { paddingTop: insets.top + space(1.5), borderBottomColor: th.hairline }]}>
        <Pressable
          style={[styles.key, { backgroundColor: th.panel }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
        >
          <Icon name="chevron-left" size={16} color={th.inkSub} />
        </Pressable>
        <View style={styles.barCenter}>
          <Text style={[styles.barTitle, { color: th.ink }]}>NIBI-WORK</Text>
          <Text style={[styles.barSub, { color: th.inkFaint }]} numberOfLines={1}>
            {phase === "failed" ? "加载失败" : phase === "loading" ? `加载中 ${Math.round(progress * 100)}%` : "桌面远控 · 与桌面同源"}
          </Text>
        </View>
        <Pressable
          style={[styles.key, { backgroundColor: th.panel }]}
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel="刷新"
        >
          <Icon name="refresh" size={16} color={th.inkSub} />
        </Pressable>
      </View>

      <View style={styles.body}>
        <WebView
          key={reloadKey}
          ref={webRef}
          source={{ uri: WORK_URL }}
          // 登录态（OAuth 回调）留在 WebView：cookie 与 storage 都要开
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
          originWhitelist={["*"]}
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
          // 语言与注入口：locale 必须先于文档加载改写，否则站点已按 en-US 渲染
          injectedJavaScriptBeforeContentLoaded={LOCALE_BOOTSTRAP}
          // 注入口（等 T7）：上游落地 transport 注入后，把 bridge 拼进同一个脚本
          // （同一时机，先 locale 后 bridge）
          onLoadStart={() => {
            setPhase("loading");
            setProgress(0);
          }}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onLoadEnd={() => setPhase((p) => (p === "failed" ? p : "ready"))}
          onNavigationStateChange={onNavChange}
          onError={({ nativeEvent }) => {
            setPhase("failed");
            setError(nativeEvent.description || "页面打不开");
          }}
          onHttpError={({ nativeEvent }) => {
            setPhase("failed");
            setError(`HTTP ${nativeEvent.statusCode}`);
          }}
          style={styles.web}
        />

        {phase === "loading" ? (
          <View style={[styles.overlay, { backgroundColor: th.bg }]} pointerEvents="none">
            <ActivityIndicator color={th.brand} />
            <Text style={[styles.overlayText, { color: th.inkFaint }]}>正在打开桌面远控…</Text>
          </View>
        ) : null}

        {phase === "failed" ? (
          <View style={[styles.overlay, { backgroundColor: th.bg }]}>
            <View style={[styles.errCard, { backgroundColor: th.card, borderColor: th.hairline }]}>
              <Text style={[styles.errTitle, { color: th.ink }]}>打不开桌面远控</Text>
              <Text style={[styles.errBody, { color: th.inkSub }]}>{error ?? "网络或服务异常"}</Text>
              <Text style={[styles.errUrl, { color: th.inkFaint }]} numberOfLines={2}>
                {WORK_URL}
              </Text>
              <View style={styles.errActions}>
                <Pressable style={[styles.errBtn, { backgroundColor: th.brand }]} onPress={retry}>
                  <Text style={[styles.errBtnText, { color: th.brandFg }]}>重试</Text>
                </Pressable>
                <Pressable
                  style={[styles.errBtn, { backgroundColor: th.panel }]}
                  onPress={() => router.back()}
                >
                  <Text style={[styles.errBtnText, { color: th.inkSub }]}>返回</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(3),
    paddingBottom: space(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barCenter: { flex: 1, alignItems: "center", gap: 1 },
  barTitle: { fontSize: 14, fontWeight: "700" },
  barSub: { fontSize: 10.5 },
  key: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  body: { flex: 1 },
  web: { flex: 1, backgroundColor: "transparent" },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
  },
  overlayText: { fontSize: t.small },
  errCard: {
    width: "82%",
    maxWidth: 420,
    padding: space(5),
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: space(2),
  },
  errTitle: { fontSize: t.heading, fontWeight: "700" },
  errBody: { fontSize: t.small, lineHeight: 19 },
  errUrl: { fontSize: 10.5 },
  errActions: { flexDirection: "row", gap: space(2), marginTop: space(1) },
  errBtn: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: radius.control },
  errBtnText: { fontSize: 14, fontWeight: "700" },
});
