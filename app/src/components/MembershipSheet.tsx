// 应用内嵌 NIBI 账号授权收银台（Sheet + WebView）：
// 仅在用户点击需要账号授权的插件「安装」且本机尚未获权时按需弹出；
// 复用 POST /api/v1/auth/handoff → https://nibistudio.cn/membership/?embedded=app&handoff=<code>
// 并向页面注入 window.nibiBridge.notifyPurchaseComplete，完成后自动同步本机授权并继续安装。

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useI18n } from "../i18n";
import { createNibiCheckoutUrl } from "../plugins/membershipCheckout";
import { syncLicense } from "../plugins/licenseSync";
import { radius, space, text, useNibiTheme } from "../theme";
import { PillButton } from "./ui/PillButton";
import { Sheet } from "./ui/Sheet";

const INJECTED_BRIDGE_JS = `
(function() {
  window.nibiBridge = {
    notifyPurchaseComplete: function(payload) {
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: "nibi-purchase-complete",
            payload: payload || { provider: "nibi" }
          }));
        }
      } catch (_) {}
    }
  };
})();
true;
`;

export interface MembershipSheetProps {
  visible: boolean;
  pluginName?: string;
  onClose: () => void;
  onLoginRequested: () => Promise<void>;
  onAuthorized: () => void;
}

type SheetErrorState =
  | { kind: "not_authorized" }
  | { kind: "sync_failed" }
  | { kind: "web_load_failed" }
  | { kind: "custom"; message: string };

export function MembershipSheet({
  visible,
  pluginName,
  onClose,
  onLoginRequested,
  onAuthorized,
}: MembershipSheetProps) {
  const t = useNibiTheme();
  const { pick } = useI18n();
  const [phase, setPhase] = useState<"loading" | "ready" | "auth_required" | "error">("loading");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<SheetErrorState | null>(null);
  const [webLoading, setWebLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const errorMessage =
    errorState === null
      ? null
      : errorState.kind === "not_authorized"
        ? pick(
            "暂未检测到生效授权，若刚完成操作请稍候几秒再点「同步状态」。",
            "No active license detected yet. If you just finished, wait a few seconds and tap Sync again.",
          )
        : errorState.kind === "sync_failed"
          ? pick("同步状态失败，请重试。", "Failed to sync status. Please try again.")
          : errorState.kind === "web_load_failed"
            ? pick(
                "页面加载失败，请检查网络后重试。",
                "Failed to load page. Check your network and try again.",
              )
            : errorState.message;

  const loadHandoffUrl = useCallback(async () => {
    setPhase("loading");
    setErrorState(null);
    setCheckoutUrl(null);
    const outcome = await createNibiCheckoutUrl();
    if (!outcome.ok) {
      setErrorState(outcome.message ? { kind: "custom", message: outcome.message } : null);
      setPhase(outcome.code === "auth_required" ? "auth_required" : "error");
      return;
    }
    setCheckoutUrl(outcome.url);
    setWebLoading(true);
    setPhase("ready");
  }, []);

  useEffect(() => {
    if (visible) {
      void loadHandoffUrl();
    } else {
      setCheckoutUrl(null);
      setPhase("loading");
      setErrorState(null);
    }
  }, [visible, loadHandoffUrl]);

  const verifyAndComplete = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setErrorState(null);
    try {
      const outcome = await syncLicense();
      if (outcome.ok && outcome.authorized) {
        onAuthorized();
        return;
      }
      setErrorState({ kind: "not_authorized" });
    } catch (error) {
      setErrorState(
        error instanceof Error
          ? { kind: "custom", message: error.message }
          : { kind: "sync_failed" },
      );
    } finally {
      setSyncing(false);
    }
  }, [syncing, onAuthorized]);

  const handleWebMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const parsed = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          payload?: { provider?: string };
        };
        if (parsed.type === "nibi-purchase-complete" && parsed.payload?.provider === "nibi") {
          void verifyAndComplete();
        }
      } catch {
        // 忽略非 JSON 消息
      }
    },
    [verifyAndComplete],
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={
        pluginName
          ? pick(`安装「${pluginName}」`, `Install "${pluginName}"`)
          : pick("NIBI 账号中心", "NIBI Account")
      }
      maxHeightRatio={0.9}
    >
      <View style={styles.container}>
        {phase === "loading" ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={t.brand} />
            <Text style={[styles.hint, { color: t.inkSub }]}>
              {pick("正在连接 NIBI 账号中心…", "Connecting to NIBI Account…")}
            </Text>
          </View>
        ) : phase === "auth_required" ? (
          <View style={styles.centerBox}>
            <Text style={[styles.title, { color: t.ink }]}>
              {pick("需要登录 NIBI 账号", "Sign in to NIBI Account")}
            </Text>
            <Text style={[styles.hint, { color: t.inkSub }]}>
              {errorMessage ??
                pick(
                  "安装该插件需要先登录你的 NIBI 账号并验证可用权限。",
                  "Sign in to your NIBI account and verify access before installing this plugin.",
                )}
            </Text>
            <View style={styles.buttonRow}>
              <PillButton
                label={pick("立即登录", "Sign in")}
                variant="primary"
                onPress={() => {
                  void onLoginRequested().then(() => loadHandoffUrl());
                }}
              />
              <PillButton label={pick("稍后再说", "Later")} variant="secondary" onPress={onClose} />
            </View>
          </View>
        ) : phase === "error" ? (
          <View style={styles.centerBox}>
            <Text style={[styles.title, { color: t.ink }]}>
              {pick("暂时无法打开页面", "Unable to open page")}
            </Text>
            <Text style={[styles.hint, { color: t.inkSub }]}>
              {errorMessage ??
                pick("请检查网络连接后重试。", "Check your network connection and try again.")}
            </Text>
            <View style={styles.buttonRow}>
              <PillButton
                label={pick("重试", "Retry")}
                variant="primary"
                onPress={() => void loadHandoffUrl()}
              />
              <PillButton label={pick("关闭", "Close")} variant="secondary" onPress={onClose} />
            </View>
          </View>
        ) : checkoutUrl ? (
          <View style={styles.webWrap}>
            <View style={[styles.webFrame, { borderColor: t.hairline, backgroundColor: t.card }]}>
              <WebView
                source={{ uri: checkoutUrl }}
                style={styles.webview}
                javaScriptEnabled
                domStorageEnabled
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                injectedJavaScriptBeforeContentLoaded={INJECTED_BRIDGE_JS}
                onMessage={handleWebMessage}
                onLoadStart={() => setWebLoading(true)}
                onLoadEnd={() => setWebLoading(false)}
                onError={() => {
                  setWebLoading(false);
                  setPhase("error");
                  setErrorState({ kind: "web_load_failed" });
                }}
              />
              {webLoading ? (
                <View style={[styles.webOverlay, { backgroundColor: t.card }]}>
                  <ActivityIndicator color={t.brand} />
                  <Text style={[styles.hint, { color: t.inkFaint }]}>
                    {pick("正在加载页面…", "Loading page…")}
                  </Text>
                </View>
              ) : null}
            </View>

            {errorMessage ? (
              <Text style={[styles.statusHint, { color: t.amber }]}>{errorMessage}</Text>
            ) : null}

            <View style={styles.footerRow}>
              <PillButton
                label={
                  syncing
                    ? pick("正在同步…", "Syncing…")
                    : pick("已完成，同步并继续安装", "Done, sync & continue")
                }
                variant="primary"
                disabled={syncing}
                onPress={() => void verifyAndComplete()}
              />
              <PillButton label={pick("关闭", "Close")} variant="secondary" onPress={onClose} />
            </View>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space(4),
    paddingBottom: space(3),
    gap: space(2.5),
    flexShrink: 1,
  },
  centerBox: {
    paddingVertical: space(8),
    paddingHorizontal: space(3),
    alignItems: "center",
    justifyContent: "center",
    gap: space(2.5),
  },
  title: {
    ...text("bodyLg"),
    fontWeight: "700",
    textAlign: "center",
  },
  hint: {
    ...text("small"),
    textAlign: "center",
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
    marginTop: space(1),
  },
  webWrap: {
    gap: space(2.5),
  },
  webFrame: {
    height: 360,
    maxHeight: "62%",
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
  webOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
  },
  statusHint: {
    ...text("micro"),
    textAlign: "center",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
  },
});
