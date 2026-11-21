// 子智能体（用户级自定义 agent）：`HOME/.nibi/agents/*.md`，frontmatter 写元信息
// （name/description 必需，model 空=继承主模型，tools 可选），正文是系统提示词。
// 内核的解析在 kernel/crates/agents/src/custom.rs + frontmatter.rs：缺 name 或
// description 的文件会被整个跳过——列表里用「格式有误」徽标把这件事说出来。
// GO 的 HOME = filesDir = expo-file-system 的 Paths.document，App 直接读写同一批文件；
// 项目级 agents 本轮不做。保存后对新开的会话生效（内核冷加载会话时才读）。
import { Directory, File, Paths } from "expo-file-system";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
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
import { AppearIn, staggerDelay } from "../../motion/appear";
import { radius, size, space, text, useNibiTheme } from "../../theme";

const DOT_DIR = ".nibi";
const AGENTS_DIR = "agents";
/** 新建时的预填模板（与桌面端同一份格式约定）。 */
const TEMPLATE = `---
name: my-agent
description: 何时使用这个子智能体（一句话）
model: ""
tools: [Read, Glob, Grep]
---

你是……（系统提示词）
`;

/** 一个 agent 文件的展示信息；raw 留作编辑器初值。 */
interface AgentEntry {
  fileName: string;
  name: string | null;
  description: string | null;
  model: string | null;
  tools: string[] | null;
  /** 内核会跳过这个文件时的原因；null = 正常。 */
  invalid: string | null;
  raw: string;
}

/** 页内编辑器状态：fileName 为 null 表示新建。 */
interface EditorState {
  fileName: string | null;
  /** 进入编辑器时的原文，脏检查基准。 */
  initial: string;
  draft: string;
}

// —— frontmatter 行解析（照 kernel frontmatter.rs 的口径，只为列表展示）——
// 支持 `key: 值`（可带引号）、`key: [a, b]`、连续 `- 项` 列表与 `|` / `>` 块。
// 编辑器始终编辑原文，这里的结果不回写。

type FrontValues = Record<string, string | string[]>;

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

function inlineList(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  return trimmed
    .slice(1, -1)
    .split(",")
    .map(unquote)
    .filter((item) => item !== "");
}

function parseFrontValues(lines: string[]): FrontValues {
  const values: FrontValues = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    index += 1;
    // 顶层的空行/注释/缩进行不认（缩进行已作为上一个键的嵌套行消费掉）。
    if (line.trim() === "" || line.trimStart().startsWith("#") || /^[ \t]/u.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    // 缩进的后续行（空行也算）：列表项或块文本。
    const nested: string[] = [];
    while (index < lines.length && (/^[ \t]/u.test(lines[index]) || lines[index].trim() === "")) {
      nested.push(lines[index]);
      index += 1;
    }
    const inline = inlineList(value);
    if (inline) {
      values[key] = inline;
      continue;
    }
    if (value === "|" || value === ">") {
      const joiner = value === "|" ? "\n" : " ";
      values[key] = nested.map((item) => item.trim()).join(joiner).trim();
      continue;
    }
    if (value === "") {
      const items: string[] = [];
      for (const nestedLine of nested) {
        const trimmed = nestedLine.trim();
        if (!trimmed.startsWith("-")) continue;
        const item = unquote(trimmed.slice(1));
        if (item !== "") items.push(item);
      }
      // 与内核一致：空值且没有列表项时键按缺省处理。
      if (items.length > 0) values[key] = items;
      continue;
    }
    values[key] = unquote(value);
  }
  return values;
}

function splitFrontmatter(raw: string): FrontValues | null {
  const withoutBom = raw.replace(/^\u{feff}/u, "");
  if (!withoutBom.startsWith("---")) return null;
  let rest = withoutBom.slice(3).replace(/^[ \t]+/u, "");
  const newline = /^\r?\n/u.exec(rest);
  if (!newline) return null;
  rest = rest.slice(newline[0].length);
  const lines = rest.split("\n");
  let closing = -1;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].replace(/\r$/u, "") === "---") {
      closing = index;
      break;
    }
  }
  if (closing < 0) return null;
  return parseFrontValues(lines.slice(0, closing));
}

/** 取文本键；列表值与空串都按缺省（与内核 Value::text 一致）。 */
function frontText(values: FrontValues, key: string): string | null {
  const value = values[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function parseEntry(fileName: string, raw: string): AgentEntry {
  const values = splitFrontmatter(raw);
  if (!values) {
    return { fileName, name: null, description: null, model: null, tools: null, invalid: "缺 frontmatter", raw };
  }
  const name = frontText(values, "name");
  const description = frontText(values, "description");
  const missing: string[] = [];
  if (!name) missing.push("name");
  if (!description) missing.push("description");
  const model = frontText(values, "model");
  const tools = Array.isArray(values.tools) && values.tools.length > 0 ? values.tools : null;
  return {
    fileName,
    name,
    description: description?.replace(/\\n/gu, " ") ?? null,
    model,
    tools,
    invalid: missing.length > 0 ? `缺 ${missing.join(" 和 ")}` : null,
    raw,
  };
}

/** name 直接进文件名，去掉文件系统不接受的字符；清空后按缺 name 处理。 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000]/gu, "").trim();
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.md$/u, "");
}

function agentTitle(entry: AgentEntry): string {
  return entry.name ?? fileStem(entry.fileName);
}

export default function SubagentsScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dir = new Directory(Paths.document, DOT_DIR, AGENTS_DIR);
      dir.create({ intermediates: true, idempotent: true });
      const files = dir
        .list()
        .filter((entry): entry is File => entry instanceof File && entry.name.endsWith(".md"))
        .sort((left, right) => left.name.localeCompare(right.name));
      const next: AgentEntry[] = [];
      for (const file of files) {
        try {
          next.push(parseEntry(file.name, await file.text()));
        } catch {
          next.push({
            fileName: file.name,
            name: null,
            description: null,
            model: null,
            tools: null,
            invalid: "读取失败",
            raw: "",
          });
        }
      }
      setEntries(next);
    } catch (error) {
      setEntries([]);
      setMessage(`读取失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = editor !== null && editor.draft !== editor.initial;

  function openNew() {
    setMessage(null);
    setEditor({ fileName: null, initial: TEMPLATE, draft: TEMPLATE });
  }

  function openEdit(entry: AgentEntry) {
    setMessage(null);
    setEditor({ fileName: entry.fileName, initial: entry.raw, draft: entry.raw });
  }

  async function save() {
    if (!editor || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      new Directory(Paths.document, DOT_DIR, AGENTS_DIR).create({ intermediates: true, idempotent: true });
      const name = sanitizeFileName(frontText(splitFrontmatter(editor.draft) ?? {}, "name") ?? "");
      let target: string;
      if (name) {
        target = `${name}.md`;
      } else if (editor.fileName) {
        // 没写 name 的老文件保留原文件名（内核仍会跳过，但原文不丢）。
        target = editor.fileName;
      } else {
        setMessage("缺 name：在 frontmatter 补上再保存");
        return;
      }
      if (editor.fileName !== target && entries.some((entry) => entry.fileName === target)) {
        setMessage(`${target} 已存在：换个 name 再保存`);
        return;
      }
      await new File(Paths.document, DOT_DIR, AGENTS_DIR, target).write(editor.draft);
      // 改名时删旧文件：写在成功之后再删，失败也不会丢内容。
      if (editor.fileName && editor.fileName !== target) {
        const previous = new File(Paths.document, DOT_DIR, AGENTS_DIR, editor.fileName);
        if (previous.exists) previous.delete();
      }
      setEditor(null);
      setMessage("已保存");
      await load();
    } catch (error) {
      setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    const current = editor;
    if (!current?.fileName) return;
    const fileName = current.fileName;
    const title = agentTitle(entries.find((entry) => entry.fileName === fileName) ?? { fileName, name: null, description: null, model: null, tools: null, invalid: null, raw: "" });
    Alert.alert(`删除「${title}」？`, "删除后不可恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void remove(fileName);
        },
      },
    ]);
  }

  async function remove(fileName: string) {
    if (!fileName) return;
    setBusy(true);
    setMessage(null);
    try {
      const file = new File(Paths.document, DOT_DIR, AGENTS_DIR, fileName);
      if (file.exists) file.delete();
      setEditor(null);
      await load();
    } catch (error) {
      setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const messageCard = message ? (
    <AppearIn>
      <View style={[styles.message, { backgroundColor: th.card, borderColor: th.hairline }]}>
        <Text style={[styles.messageText, { color: th.inkSub }]}>{message}</Text>
      </View>
    </AppearIn>
  ) : null;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="子智能体" onBack={() => router.back()} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "android" ? undefined : "padding"}
      >
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}
        >
          <AppearIn>
            <Text style={[styles.intro, { color: th.inkSub }]}>
              每个子智能体一个 md 文件：frontmatter 写元信息，正文是系统提示词。
            </Text>
          </AppearIn>

          {editor ? (
            // 编辑器：直接编辑 md 原文（不做结构化表单，保存即覆写文件）。
            <AppearIn>
              <SectionCard label={editor.fileName ?? "新建子智能体"}>
                <TextInput
                  value={editor.draft}
                  onChangeText={(draft) => setEditor({ ...editor, draft })}
                  placeholder={"---\nname: \ndescription: \n---\n\n……"}
                  placeholderTextColor={th.inkFaint}
                  multiline
                  textAlignVertical="top"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.editor, { color: th.ink, borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}
                />
                <View style={styles.metaRow}>
                  {dirty ? <Text style={[styles.meta, { color: th.amber }]}>未保存</Text> : null}
                </View>
              </SectionCard>
            </AppearIn>
          ) : null}

          {editor ? (
            <View style={styles.actions}>
              <PillButton label="取消" variant="secondary" disabled={busy} onPress={() => setEditor(null)} />
              {editor.fileName ? (
                <PillButton label="删除" variant="danger" disabled={busy} onPress={confirmDelete} />
              ) : null}
              <PillButton
                label={busy ? "保存中…" : "保存"}
                variant="primary"
                disabled={busy || !dirty}
                onPress={() => void save()}
              />
            </View>
          ) : loading && entries.length === 0 ? (
            <AppearIn>
              <SectionCard>
                <View style={styles.empty}>
                  <ActivityIndicator color={th.brand} size="small" />
                </View>
              </SectionCard>
            </AppearIn>
          ) : entries.length === 0 ? (
            // 空态：一张卡说明 + 新建入口。
            <AppearIn>
              <SectionCard>
                <View style={styles.empty}>
                  <Text style={[styles.emptyTitle, { color: th.ink }]}>还没有子智能体</Text>
                  <PillButton label="新建" variant="primary" icon="plus" onPress={openNew} />
                </View>
              </SectionCard>
            </AppearIn>
          ) : (
            <>
              {entries.map((entry, index) => (
                <AppearIn key={entry.fileName} delay={staggerDelay(index, 32, 240)}>
                  <SectionCard>
                    <Row
                      icon={entry.invalid ? "doc" : "sparkles"}
                      tone={entry.invalid ? "amber" : "brand"}
                      title={agentTitle(entry)}
                      detail={entry.invalid ?? entry.description ?? undefined}
                      right={
                        <View style={styles.rightSlot}>
                          {entry.invalid ? (
                            <View style={[styles.badge, { backgroundColor: th.amberSoft }]}>
                              <Text style={[styles.badgeText, { color: th.amber }]}>格式有误</Text>
                            </View>
                          ) : null}
                          <PillButton
                            label="编辑"
                            variant="secondary"
                            onPress={() => openEdit(entry)}
                          />
                        </View>
                      }
                    />
                    {entry.invalid === null && (entry.model || entry.tools) ? (
                      // 与行内标题对齐（行左距 + 图标底 + 间距）。
                      <Text style={[styles.agentMeta, { color: th.inkFaint }]}>
                        {[
                          entry.model ? `模型 ${entry.model}` : null,
                          entry.tools ? `工具 ${entry.tools.join("、")}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    ) : null}
                  </SectionCard>
                </AppearIn>
              ))}
              <AppearIn delay={staggerDelay(entries.length, 32, 240)}>
                <SectionCard>
                  <Row icon="plus" tone="brand" title="新建子智能体" onPress={openNew} />
                </SectionCard>
              </AppearIn>
            </>
          )}

          {editor ? null : (
            <AppearIn delay={staggerDelay(entries.length + 1, 32, 240)}>
              <Row icon="info" tone="plain" title="何时生效" detail="保存后对新开的会话生效" />
            </AppearIn>
          )}

          {messageCard}
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
    paddingHorizontal: space(1),
    paddingTop: space(1.5),
  },
  meta: { ...text("micro") },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space(2) },
  rightSlot: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  badge: {
    borderRadius: radius.xs,
    paddingHorizontal: space(1.5),
    paddingVertical: space(0.5),
  },
  badgeText: { ...text("micro"), fontWeight: "600" },
  agentMeta: {
    ...text("micro"),
    paddingLeft: space(3.5) + size.chipLg + space(3),
    paddingBottom: space(2.5),
  },
  empty: { alignItems: "center", gap: space(2.5), paddingVertical: space(5) },
  emptyTitle: { ...text("body"), fontWeight: "600" },
  message: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
  },
  messageText: { ...text("small") },
});
