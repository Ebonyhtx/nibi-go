// 个性化指令（用户级 AGENTS.md）：所有会话共享的全局 Agent 指令。
// 文件是内核冷加载会话时读的 `HOME/.nibi/AGENTS.md`（context/rules_load.rs Kind::User）；
// GO 的 HOME = filesDir = expo-file-system 的 Paths.document——App 直接读写同一份文件。
// 保存后对已打开的会话不生效（内核只在会话冷加载时读一次），UI 上要说明。
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Row } from "../../components/ui/Row";
import { SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { PillButton } from "../../components/ui/PillButton";
import { AppearIn } from "../../motion/appear";
import { radius, space, text, useNibiTheme } from "../../theme";

const DIRECTORY = ".nibi";
const FILE_NAME = "AGENTS.md";
/** 与桌面端同一份门禁（settingsSync.ts USER_AGENTS_LIMIT）。 */
const LIMIT_BYTES = 100 * 1024;

export default function PersonalizationScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const [initial, setInitial] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { Directory, File, Paths } = await import("expo-file-system");
      new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
      const file = new File(Paths.document, DIRECTORY, FILE_NAME);
      const content = file.exists ? await file.text() : "";
      setInitial(content);
      setDraft(content);
    } catch (error) {
      setMessage(`读取失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bytes = new TextEncoder().encode(draft).length;
  const dirty = initial !== null && draft !== initial;
  const overLimit = bytes > LIMIT_BYTES;

  async function save() {
    if (busy || overLimit) return;
    setBusy(true);
    setMessage(null);
    try {
      const { Directory, File, Paths } = await import("expo-file-system");
      new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
      const file = new File(Paths.document, DIRECTORY, FILE_NAME);
      await file.write(draft);
      setInitial(draft);
      setMessage("已保存；对新开的会话生效。");
    } catch (error) {
      setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="个性化指令" onBack={() => router.back()} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "android" ? undefined : "padding"}
      >
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}
        >
          {/* 2.0.1 口径：说明压成一句，行为细节（何时生效）放保存后的反馈。 */}
          <AppearIn>
            <Text style={[styles.intro, { color: th.inkSub }]}>
              写给所有会话的全局指令（AGENTS.md）。
            </Text>
          </AppearIn>

          <AppearIn>
            <SectionCard>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={"例如：\n- 回答用中文\n- 提交信息用英文\n- 优先复用既有工具，不要重复造轮子"}
                placeholderTextColor={th.inkFaint}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.editor, { color: th.ink, borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}
              />
              <View style={styles.metaRow}>
                <Text style={[styles.meta, { color: overLimit ? th.red : th.inkFaint }]}>
                  {bytes} / {LIMIT_BYTES / 1024} KB
                </Text>
                {dirty ? (
                  <Text style={[styles.meta, { color: th.amber }]}>未保存</Text>
                ) : null}
              </View>
            </SectionCard>
          </AppearIn>

          <AppearIn>
            <Row
              icon="info"
              tone="plain"
              title="何时生效"
              detail="保存后对新开的会话生效"
            />
          </AppearIn>

          {message ? (
            <AppearIn>
              <View style={[styles.message, { backgroundColor: th.card, borderColor: th.hairline }]}>
                <Text style={[styles.messageText, { color: th.inkSub }]}>{message}</Text>
              </View>
            </AppearIn>
          ) : null}

          <View style={styles.actions}>
            <PillButton
              label="撤销修改"
              variant="secondary"
              disabled={!dirty || busy || initial === null}
              onPress={() => {
                setDraft(initial ?? "");
                setMessage(null);
              }}
            />
            <PillButton
              label={busy ? "保存中…" : "保存"}
              variant="primary"
              disabled={busy || overLimit || !dirty}
              onPress={() => void save()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(3) },
  intro: { ...text("small") },
  editor: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    minHeight: 240,
    ...text("body"),
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space(3),
    paddingHorizontal: space(1),
    paddingTop: space(1.5),
  },
  meta: { ...text("micro") },
  message: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
  },
  messageText: { ...text("small") },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space(2) },
});
