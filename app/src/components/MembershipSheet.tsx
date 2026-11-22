// 应用内嵌 NIBI 账号授权收银台（Sheet + WebView）：
// 仅在用户点击需要账号授权的插件「安装」且本机尚未获权时按需弹出；
// 复用 POST /api/v1/auth/handoff → https://nibistudio.cn/membership/?embedded=app&handoff=<code>
// 并向页面注入 window.nibiBridge.notifyPurchaseComplete，完成后自动同步本机授权并继续安装。

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

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

export function MembershipSheet({
  visible,
  pluginName,
  onClose,
  onLoginRequested,
  onAuthorized,
}: MembershipSheetProps) {
  const t = useNibiTheme();
  const [phase, setPhase] = useState<"loading" | "ready" | "auth_required" | "error">("loading");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [webLoading, setWebLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadHandoffUrl = useCallback(async () => {
    setPhase("loading");
    setErrorMessage(null);
    setCheckoutUrl(null);
    const outcome = await createNibiCheckoutUrl();
    if (!outcome.ok) {
      setErrorMessage(outcome.message);
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
      setErrorMessage(null);
    }
  }, [visible, loadHandoffUrl]);

  const verifyAndComplete = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setErrorMessage(null);
    try {
      const outcome = await syncLicense();
      if (outcome.ok && outcome.authorized) {
        onAuthorized();
        return;
      }
      setErrorMessage("暂未检测到生效授权，若刚完成操作请稍候几秒再点「同步状态」。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "同步状态失败，请重试。");
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
      title={pluginName ? `安装「${pluginName}」` : "NIBI 账号中心"}
      maxHeightRatio={0.9}
    >
      <View style={styles.container}>
        {phase === "loading" ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={t.brand} />
            <Text style={[styles.hint, { color: t.inkSub }]}>正在连接 NIBI 账号中心…</Text>
          </View>
        ) : phase === "auth_required" ? (
          <View style={styles.centerBox}>
            <Text style={[styles.title, { color: t.ink }]}>需要登录 NIBI 账号</Text>
            <Text style={[styles.hint, { color: t.inkSub }]}>
              {errorMessage ?? "安装该插件需要先登录你的 NIBI 账号并验证可用权限。"}
            </Text>
            <View style={styles.buttonRow}>
              <PillButton
                label="立即登录"
                variant="primary"
                onPress={() => {
                  void onLoginRequested().then(() => loadHandoffUrl());
                }}
              />
              <PillButton label="稍后再说" variant="secondary" onPress={onClose} />
            </View>
          </View>
        ) : phase === "error" ? (
          <View style={styles.centerBox}>
            <Text style={[styles.title, { color: t.ink }]}>暂时无法打开页面</Text>
            <Text style={[styles.hint, { color: t.inkSub }]}>
              {errorMessage ?? "请检查网络连接后重试。"}
            </Text>
            <View style={styles.buttonRow}>
              <PillButton label="重试" variant="primary" onPress={() => void loadHandoffUrl()} />
              <PillButton label="关闭" variant="secondary" onPress={onClose} />
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
                  setErrorMessage("页面加载失败，请检查网络后重试。");
                }}
              />
              {webLoading ? (
                <View style={[styles.webOverlay, { backgroundColor: t.card }]}>
                  <ActivityIndicator color={t.brand} />
                  <Text style={[styles.hint, { color: t.inkFaint }]}>正在加载页面…</Text>
                </View>
              ) : null}
            </View>

            {errorMessage ? (
              <Text style={[styles.statusHint, { color: t.amber }]}>{errorMessage}</Text>
            ) : null}

            <View style={styles.footerRow}>
              <PillButton
                label={syncing ? "正在同步…" : "已完成，同步并继续安装"}
                variant="primary"
                disabled={syncing}
                onPress={() => void verifyAndComplete()}
              />
              <PillButton label="关闭" variant="secondary" onPress={onClose} />
            </View>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 420,
    paddingHorizontal: space(4),
    paddingBottom: space(3),
    gap: space(2.5),
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
    height: 460,
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
