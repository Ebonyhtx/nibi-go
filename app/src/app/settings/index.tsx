// 设置首页：先分页，不再把所有配置堆在一页。
//
// 模型/Provider、COMPOSE 快捷动作、插件、关于分开；后续新设置按入口加，不继续往下堆。
// 2.0：SectionCard 分组 + ui/Row 统一行；新增「外观」分组（主题三选，
// 写 appearance/preferences——useNibiTheme 消费同一份偏好，切换即时生效）。

import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { Fragment, useCallback, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  saveAppearancePreferences,
  useAppearanceMode,
  type AppearanceMode,
} from "../../appearance/preferences";
import { Icon, type IconName } from "../../components/Icon";
import { Row, type RowTone } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { dismissKeyboardOnFocus } from "../../composer/leave";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { useSession } from "../../relay/useSession";
import { radius, space, text, useNibiTheme } from "../../theme";

/** 主题三选（跟随系统/浅色/墨夜深色）。行保持轻量：切主题会触发全应用重渲染。 */
const APPEARANCE_MODES: readonly {
  mode: AppearanceMode;
  icon: IconName;
  tone: RowTone;
  title: string;
  detail: string;
}[] = [
  { mode: "system", icon: "question", tone: "plain", title: "跟随系统", detail: "与系统深浅色保持一致" },
  { mode: "light", icon: "sun", tone: "amber", title: "浅色", detail: "纸面浅色主题" },
  { mode: "dark", icon: "moon", tone: "steel", title: "墨夜深色", detail: "深色主题（深色下不用蓝）" },
];

export default function SettingsHomeScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const { session, snapshot } = useSession();
  const appearanceMode = useAppearanceMode();
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);

  // 从首页带着输入框焦点进来时，键盘会弹一下又收回去；进入设置先明确收起。
  useFocusEffect(
    useCallback(() => {
      dismissKeyboardOnFocus(Keyboard.dismiss);
    }, []),
  );

  async function login(force = false) {
    if (accountBusy) return;
    setAccountBusy(true);
    setAccountMessage(null);
    try {
      await session.login(force);
      const current = session.getSnapshot();
      if (!current.loggedIn) {
        setAccountMessage(current.error?.message ?? "登录没有完成，请重试");
      } else {
        setAccountMessage("已登录；进入插件市场会自动同步本机授权。");
      }
    } finally {
      setAccountBusy(false);
    }
  }

  function logout() {
    Alert.alert("退出 NIBI 账号？", "配对凭据会保留；本机已同步的付费授权也会保留到过期。", [
      { text: "取消", style: "cancel" },
      {
        text: "退出登录",
        style: "destructive",
        onPress: () => {
          setAccountBusy(true);
          void session
            .logout()
            .then(() => setAccountMessage("已退出登录"))
            .finally(() => setAccountBusy(false));
        },
      },
    ]);
  }

  return (
    <View style={styles.root}>
      {/* 页面纸面：与首页同一条竖向渐变（顶部暖光 → 纸面 → 纸底）。 */}
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="设置" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <SectionCard label="账号">
            <Row
              icon="shield"
              tone="steel"
              title={
                snapshot.loggedIn
                  ? `已登录${snapshot.displayName ? `：${snapshot.displayName}` : ""}`
                  : "登录 NIBI 账号"
              }
              detail={
                snapshot.loggedIn
                  ? "切换账号；插件授权按本机设备同步"
                  : "配对、设备列表与付费插件授权都用这个登录"
              }
              onPress={() => void login(snapshot.loggedIn)}
            />
            {snapshot.loggedIn ? (
              <>
                <Divider />
                <Row
                  icon="x"
                  danger
                  title="退出登录"
                  detail="配对凭据保留；本机授权保留到过期"
                  onPress={logout}
                />
              </>
            ) : null}
          </SectionCard>
        </AppearIn>

        {accountMessage ? (
          <AppearIn delay={staggerDelay(1, 32, 240)}>
            <View style={[styles.accountMessage, { backgroundColor: th.card, borderColor: th.hairline }]}>
              {accountBusy ? <ActivityIndicator color={th.brand} /> : null}
              <Text style={[styles.accountMessageText, { color: th.inkSub }]}>{accountMessage}</Text>
            </View>
          </AppearIn>
        ) : null}

        <AppearIn delay={staggerDelay(2, 32, 240)}>
          <SectionCard label="交互">
            <Row
              icon="sliders"
              title="COMPOSE 快捷动作"
              detail="胶囊、加号菜单、长按消息菜单的启用与排序"
              onPress={() => router.push("/settings/composer")}
            />
            <Divider />
            <Row
              icon="sparkles"
              title="会话"
              detail="思考与工具调用的显示方式"
              onPress={() => router.push("/settings/conversation")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(3, 32, 240)}>
          <SectionCard label="模型">
            <Row
              icon="monitor"
              tone="steel"
              title="Provider 与模型"
              detail="供应商、模型能力、思考档位与 API Key"
              onPress={() => router.push("/settings/provider")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(4, 32, 240)}>
          <SectionCard label="Agent">
            <Row
              icon="sparkles"
              title="记忆"
              detail="本机共享的自动记忆；开关、占用与清空"
              onPress={() => router.push("/settings/memory")}
            />
            <Divider />
            <Row
              icon="sliders"
              tone="steel"
              title="记忆与链路诊断"
              detail="缓存命中率、逐轮用量与模型网络状态"
              onPress={() => router.push("/settings/diagnostics")}
            />
          </SectionCard>
        </AppearIn>

        {/* 外观：三选一，选中项右槽画勾；点击即写入并即时换主题。 */}
        <AppearIn delay={staggerDelay(5, 32, 240)}>
          <SectionCard label="外观">
            {APPEARANCE_MODES.map((item, index) => (
              <Fragment key={item.mode}>
                {index > 0 ? <Divider /> : null}
                <Row
                  icon={item.icon}
                  tone={item.tone}
                  title={item.title}
                  detail={item.detail}
                  onPress={() => void saveAppearancePreferences({ version: 1, mode: item.mode })}
                  right={
                    appearanceMode === item.mode ? (
                      <Icon name="check" size={14} color={th.brand} />
                    ) : (
                      <View />
                    )
                  }
                />
              </Fragment>
            ))}
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(6, 32, 240)}>
          <SectionCard label="手机">
            <Row
              icon="phone"
              title="手机操控"
              detail="无障碍读屏/点按与 Shizuku 高级模式"
              onPress={() => router.push("/settings/phone")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(7, 32, 240)}>
          <SectionCard label="插件">
            <Row
              icon="puzzle"
              title="插件管理"
              detail="启用/停用插件、查看面板与网页入口"
              onPress={() => router.push("/plugins")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(8, 32, 240)}>
          <SectionCard label="关于">
            <View style={styles.about}>
              <Text style={[styles.aboutTitle, { color: th.ink }]}>NIBI-GO</Text>
              <Text style={[styles.aboutDetail, { color: th.inkFaint }]}>
                版本 {version} · 本机内核 · 模型请求按当前 Provider 发出
              </Text>
            </View>
          </SectionCard>
        </AppearIn>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(4) },
  accountMessage: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
  },
  accountMessageText: { flex: 1, ...text("small") },
  about: { padding: space(3), gap: space(0.5) },
  aboutTitle: { ...text("body"), fontWeight: "700" },
  aboutDetail: { ...text("small") },
});
