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
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  WebView as RawWebView,
  type WebViewNavigation,
  type WebViewProps,
} from "react-native-webview";

import { Icon } from "../components/Icon";
import { useI18n, type Locale } from "../i18n";
import { PressableScale } from "../motion/PressableScale";
import { ENDPOINT_ORIGIN } from "../relay/config";
import { fetchWebviewTicket, gateBootstrapScript } from "../relay/webviewTicket";
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
 * 文档加载前注入：把 WebView 的语言钉成与 App 一致的当前语言。
 * 不注入时站点按 WebView 的 Accept-Language 判成 en-US，界面变英文——与桌面/官网
 * 的中文体验不一致（2026-11-13 模拟器实拍：登录卡显示 "Sign In To Continue"）。
 * navigator.language 是只读属性，用 defineProperty 覆写；同时设 document lang。
 */
function buildLocaleBootstrap(locale: Locale): string {
  const langs = locale === "en-US" ? "['en-US', 'en']" : "['zh-CN', 'zh']";
  return `
(() => {
  try {
    const L = ${JSON.stringify(locale)};
    Object.defineProperty(navigator, 'language', { get: () => L, configurable: true });
    Object.defineProperty(navigator, 'languages', { get: () => ${langs}, configurable: true });
    document.documentElement.lang = L;
  } catch {}
})();
true;
`;
}

/**
 * 页面加载后看门狗：远控页卡在品牌 logo/loading 壳时，把诊断回传给原生。
 *
 * 2026-11-17 的 NIBI 4.1.1 web-remote 产物把 Vite `--base=/remote/v4/` 在 Git Bash 里
 * 改写成了 `C:/Program Files/Git/remote/v4/`，JS/CSS 全部 404，页面只剩 logo。
 * 这不是 GO 的 relay 层问题；WebView 只能识别并解释，不能替桌面修资源。
 */
const BOOT_WATCHDOG = `
(() => {
  setTimeout(() => {
    try {
      if (!document.querySelector('.nibi-boot-loading')) return;
      const broken = Array.from(document.scripts)
        .map((script) => script.src || '')
        .filter((src) => /\\/Program(%20| )Files\\//i.test(src));
      // 只报已知的发布路径损坏；普通慢网/慢启动不误判。
      if (broken.length === 0) return;
      window.ReactNativeWebView &&
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: 'nibi-work-stuck', broken: broken.slice(0, 3) })
        );
    } catch {}
  }, 4000);
})();
true;
`;

export default function WorkScreen() {
  const th = useNibiTheme();
  const { locale, pick } = useI18n();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebViewHandle>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string>();
  // 登录页门禁 ticket：普通浏览器拿不到，NIBI-GO 在页面里写成 Domain=nibistudio.cn
  // 的 Cookie，登录导航时带上；10 分钟有效，login-ui 收到后换发 2 小时 Cookie。
  const [ticket, setTicket] = useState<string | null>(null);
  const [ticketFailed, setTicketFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setTicket(null);
    setTicketFailed(false);
    setPhase("loading");
    void fetchWebviewTicket().then((value) => {
      if (!alive) return;
      if (!value) {
        setTicketFailed(true);
        setPhase("failed");
        return;
      }
      setTicket(value);
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // 长时间停留在 WORK 页时续 ticket：只刷新 Cookie，不重载页面（页面状态保留）。
  useEffect(() => {
    const timer = setInterval(
      () => {
        void fetchWebviewTicket().then((value) => {
          if (!value) return;
          setTicket(value);
          webRef.current?.injectJavaScript(gateBootstrapScript(value));
        });
      },
      5 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, []);

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
    setTicketFailed(false);
    setPhase("loading");
    setProgress(0);
    setReloadKey((k) => k + 1);
  };

  return (
    <View style={[styles.root, { backgroundColor: th.bg }]}>
      {/* 薄顶栏：页面自己有完整 UI，这里只提供壳能力（返回 / 刷新 / 关闭） */}
      <View
        style={[
          styles.bar,
          {
            paddingTop: insets.top + space(1.5),
            paddingLeft: insets.left + space(3),
            paddingRight: insets.right + space(3),
            borderBottomColor: th.hairline,
          },
        ]}
      >
        <PressableScale
          scaleTo={0.95}
          style={[styles.key, { backgroundColor: th.panel }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={pick("返回", "Back")}
        >
          <Icon name="chevron-left" size={16} color={th.inkSub} />
        </PressableScale>
        <View style={styles.barCenter}>
          <Text style={[styles.barTitle, { color: th.ink }]}>NIBI-WORK</Text>
          <Text style={[styles.barSub, { color: th.inkFaint }]} numberOfLines={1}>
            {phase === "failed"
              ? pick("加载失败", "Load failed")
              : phase === "loading"
                ? pick(`加载中 ${Math.round(progress * 100)}%`, `Loading ${Math.round(progress * 100)}%`)
                : pick("桌面远控", "Desktop Remote")}
          </Text>
        </View>
        <PressableScale
          scaleTo={0.95}
          style={[styles.key, { backgroundColor: th.panel }]}
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel={pick("刷新", "Refresh")}
        >
          <Icon name="refresh" size={16} color={th.inkSub} />
        </PressableScale>
      </View>

      <View
        style={[
          styles.body,
          {
            paddingLeft: insets.left,
            paddingRight: insets.right,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        {ticket ? (
          <WebView
            key={`${reloadKey}-${locale}`}
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
            // 语言与注入口：locale 必须先于文档加载改写，否则站点已按 en-US 渲染；
            // ticket 写成父域 Cookie，登录导航到 auth.nibistudio.cn 时才会带上。
            injectedJavaScriptBeforeContentLoaded={`${gateBootstrapScript(ticket)}\n${buildLocaleBootstrap(locale)}`}
            injectedJavaScript={BOOT_WATCHDOG}
          onMessage={({ nativeEvent }) => {
            try {
              const message = JSON.parse(nativeEvent.data) as {
                type?: unknown;
                broken?: unknown;
              };
              if (message.type !== "nibi-work-stuck") return;
              const broken = Array.isArray(message.broken)
                ? message.broken.filter((item): item is string => typeof item === "string")
                : [];
              setPhase("failed");
              setError(
                broken.length > 0
                  ? pick(
                      `桌面端远控页面资源路径损坏（${broken[0]}）。这是 NIBI 桌面端发布问题，不是网络问题；请更新桌面端或等待服务端修复。`,
                      `Desktop remote page asset path is broken (${broken[0]}). This is a NIBI desktop release issue, not a network issue. Update desktop or wait for a server fix.`,
                    )
                  : pick(
                      "桌面远控页面没有启动，请刷新或更新桌面端。",
                      "Desktop remote page failed to start. Refresh or update desktop.",
                    ),
              );
            } catch {
              // 非本看门狗的消息忽略。
            }
          }}
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
            setError(nativeEvent.description || pick("页面打不开", "Unable to open page"));
          }}
          onHttpError={({ nativeEvent }) => {
            setPhase("failed");
            setError(`HTTP ${nativeEvent.statusCode}`);
          }}
          style={styles.web}
          />
        ) : null}

        {phase === "loading" ? (
          <View style={[styles.overlay, { backgroundColor: th.bg }]} pointerEvents="none">
            <ActivityIndicator color={th.brand} />
            <Text style={[styles.overlayText, { color: th.inkFaint }]}>
              {pick("正在打开桌面远控…", "Opening desktop remote…")}
            </Text>
          </View>
        ) : null}

        {phase === "failed" ? (
          <View style={[styles.overlay, { backgroundColor: th.bg }]}>
            <View style={[styles.errCard, { backgroundColor: th.card, borderColor: th.hairline }]}>
              <Text style={[styles.errTitle, { color: th.ink }]}>
                {pick("打不开桌面远控", "Cannot open desktop remote")}
              </Text>
              <Text style={[styles.errBody, { color: th.inkSub }]}>
                {error ??
                  (ticketFailed
                    ? pick(
                        "无法获取登录门禁凭证（ticket）。请检查网络后重试。",
                        "Unable to obtain sign-in gate ticket. Check your network and retry.",
                      )
                    : pick("网络或服务异常", "Network or service error"))}
              </Text>
              <Text style={[styles.errUrl, { color: th.inkFaint }]} numberOfLines={2}>
                {WORK_URL}
              </Text>
              <View style={styles.errActions}>
                <PressableScale
                  scaleTo={0.95}
                  containerStyle={styles.errBtnWrap}
                  style={[styles.errBtn, { backgroundColor: th.brand }]}
                  onPress={retry}
                >
                  <Text style={[styles.errBtnText, { color: th.brandFg }]}>
                    {pick("重试", "Retry")}
                  </Text>
                </PressableScale>
                <PressableScale
                  scaleTo={0.95}
                  containerStyle={styles.errBtnWrap}
                  style={[styles.errBtn, { backgroundColor: th.panel }]}
                  onPress={() => router.back()}
                >
                  <Text style={[styles.errBtnText, { color: th.inkSub }]}>
                    {pick("返回", "Back")}
                  </Text>
                </PressableScale>
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
  errBtnWrap: { flex: 1 },
  errBtn: { alignItems: "center", paddingVertical: 11, borderRadius: radius.control },
  errBtnText: { fontSize: 14, fontWeight: "700" },
});
