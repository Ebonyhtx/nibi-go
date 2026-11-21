// 子智能体：`HOME/.nibi/agents/*.md`（用户级）与 `<项目 workspace>/.nibi/agents/*.md`
// （项目级，作用域切换），frontmatter 写元信息（name/description 必需，model 空=继承
// 主模型，tools 可选），正文是系统提示词。内核的解析在 kernel/crates/agents/src/custom.rs
// + frontmatter.rs：缺 name 或 description 的文件会被整个跳过——列表用「格式有误」徽标
// 把这件事说出来；内核只扫目录根的 *.md，所以「停用」= 把文件移进 disabled/ 子目录。
// GO 的 HOME = filesDir = expo-file-system 的 Paths.document，App 直接读写同一批文件；
// 保存后对新开的会话生效（内核冷加载会话时才读）。
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
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Row } from "../../components/ui/Row";
import { SectionCard } from "../../components/ui/SectionCard";
import { Divider } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { PillButton } from "../../components/ui/PillButton";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { PressableScale } from "../../motion/PressableScale";
import { radius, size, space, text, useNibiTheme } from "../../theme";

import { useProviderCatalog } from "../../kernel/useProviderCatalog";
import { Icon } from "../../components/Icon";
import { useProjects } from "../../kernel/projects";
import { documentRootOf, fileUriOf, projectWorkspacePath } from "../../kernel/workspace";

const DOT_DIR = ".nibi";
const AGENTS_DIR = "agents";
const DISABLED_DIR = "disabled";
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
  /** 相对 agents 根的路径：根目录 = 启用；disabled/ 下 = 停用。 */
  relPath: string;
  fileName: string;
  name: string | null;
  description: string | null;
  model: string | null;
  tools: string[] | null;
  /** 内核会跳过这个文件时的原因；null = 正常。 */
  invalid: string | null;
  raw: string;
}

/** 常用内置工具（chips 快选；桌面端表单的对应物）。 */
const COMMON_TOOLS: readonly string[] = [
  "Read",
  "Glob",
  "Grep",
  "Bash",
  "Write",
  "Edit",
  "WebFetch",
  "Agent",
];

/** 页内编辑器状态：relPath 为 null 表示新建；mode=form 表单 / raw 原文兜底。 */
interface EditorState {
  scope: Scope;
  relPath: string | null;
  mode: "form" | "raw";
  name: string;
  description: string;
  model: string;
  tools: string[];
  prompt: string;
  /** 原文件 frontmatter 里表单之外的键（保存时原样保留；顺序不变）。 */
  extraEntries: [string, string | string[]][];
  /** 原文件全文（raw 模式直接编辑这段）。 */
  raw: string;
  /** 进入编辑器时的表单快照（脏检查基准）。 */
  initialSnapshot: string;
}

/** 表单脏检查：与进入时的快照逐字段比。 */
function formSnapshot(state: {
  name: string;
  description: string;
  model: string;
  tools: string[];
  prompt: string;
}): string {
  return JSON.stringify([
    state.name,
    state.description,
    state.model,
    state.tools,
    state.prompt,
  ]);
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

function parseEntry(relPath: string, raw: string): AgentEntry {
  const fileName = relPath.split("/").pop() ?? relPath;
  const values = splitFrontmatter(raw);
  if (!values) {
    return { relPath, fileName, name: null, description: null, model: null, tools: null, invalid: "缺 frontmatter", raw };
  }
  const name = frontText(values, "name");
  const description = frontText(values, "description");
  const missing: string[] = [];
  if (!name) missing.push("name");
  if (!description) missing.push("description");
  const model = frontText(values, "model");
  const tools = Array.isArray(values.tools) && values.tools.length > 0 ? values.tools : null;
  return {
    relPath,
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

/** 表单 → md 全文：四个表单键 + 表单外的键原样保留 + 正文。 */
function buildDocument(fields: {
  name: string;
  description: string;
  model: string;
  tools: string[];
  prompt: string;
  extraEntries: [string, string | string[]][];
}): string {
  const lines = ["---"];
  const emit = (key: string, value: string | string[]): void => {
    if (Array.isArray(value)) {
      if (value.length > 0) lines.push(`${key}: [${value.join(", ")}]`);
      return;
    }
    if (value.trim() !== "") lines.push(`${key}: ${value}`);
  };
  emit("name", fields.name);
  emit("description", fields.description);
  // model 永远落一行（空 = 继承主模型），与桌面模板一致。
  lines.push(`model: ${fields.model}`);
  emit("tools", fields.tools);
  for (const [key, value] of fields.extraEntries) {
    if (["name", "description", "model", "tools"].includes(key)) continue;
    emit(key, value);
  }
  lines.push("---", "", fields.prompt.trim());
  return `${lines.join("\n")}\n`;
}
function fileStem(fileName: string): string {
  return fileName.replace(/\.md$/u, "");
}

function agentTitle(entry: AgentEntry): string {
  return entry.name ?? fileStem(entry.fileName);
}

type Scope = "user" | "project";

export default function SubagentsScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const { projects, activeProjectId } = useProjects();
  const providerCatalog = useProviderCatalog();
  const activeProject = projects.find((project) => project.id === activeProjectId);
  // 作用域：用户级 agents/ 或当前项目的 workspace/.nibi/agents（没有当前项目时不可选）。
  const [scope, setScope] = useState<Scope>("user");
  const [entries, setEntries] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 编辑器里的模型下拉展开态（providerCatalog 的模型列表 + 继承主模型）。
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  /** 作用域的 agents 根（裸路径）。 */
  const agentsRoot = (target: Scope): string => {
    const filesRoot = documentRootOf(Paths.document.uri);
    if (target === "project" && activeProject) {
      return `${projectWorkspacePath(filesRoot, activeProject.id)}/${DOT_DIR}/${AGENTS_DIR}`;
    }
    return `${filesRoot}/${DOT_DIR}/${AGENTS_DIR}`;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const root = agentsRoot(scope);
      new Directory(fileUriOf(root)).create({ intermediates: true, idempotent: true });
      const next: AgentEntry[] = [];
      // 根目录 *.md = 启用；disabled/ 子目录 *.md = 停用（内核只扫目录根）。
      const collect = async (relPrefix: string): Promise<void> => {
        const dir = new Directory(fileUriOf(relPrefix ? `${root}/${relPrefix}` : root));
        if (!dir.exists) return;
        const files = dir
          .list()
          .filter((entry): entry is File => entry instanceof File && entry.name.endsWith(".md"))
          .sort((left, right) => left.name.localeCompare(right.name));
        for (const file of files) {
          const relPath = relPrefix ? `${relPrefix}/${file.name}` : file.name;
          try {
            next.push(parseEntry(relPath, await file.text()));
          } catch {
            next.push({
              relPath,
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
      };
      await collect("");
      await collect(DISABLED_DIR);
      setEntries(next);
    } catch (error) {
      setEntries([]);
      setMessage(`读取失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [scope, activeProject?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    editor !== null &&
    (editor.mode === "raw"
      ? editor.raw !== editor.initialSnapshot
      : formSnapshot(editor) !== editor.initialSnapshot);

  /** 原文 → 表单字段；frontmatter 里表单之外的键收集进 extraEntries（保存时原样保留）。 */
  function formStateOf(scope: Scope, relPath: string | null, raw: string): EditorState {
    const values = splitFrontmatter(raw);
    const textOf = (key: string): string => {
      const value = values?.[key];
      return typeof value === "string" ? value : "";
    };
    const tools = Array.isArray(values?.tools) ? (values?.tools as string[]) : [];
    const extraEntries: [string, string | string[]][] = Object.entries(values ?? {})
      .filter(([key]) => !["name", "description", "model", "tools"].includes(key))
      .map(([key, value]) => [key, value] as [string, string | string[]]);
    const promptText = (raw.split("---")[2] ?? "").replace(/^\r?\n/u, "");
    const fields = {
      name: textOf("name"),
      description: textOf("description"),
      model: textOf("model"),
      tools,
      prompt: promptText,
    };
    return {
      scope,
      relPath,
      mode: "form",
      ...fields,
      extraEntries,
      raw,
      initialSnapshot: formSnapshot(fields),
    };
  }

  function openNew() {
    setMessage(null);
    setModelPickerOpen(false);
    setEditor(formStateOf(scope, null, TEMPLATE));
  }

  function openEdit(entry: AgentEntry) {
    setMessage(null);
    setModelPickerOpen(false);
    setEditor(formStateOf(scope, entry.relPath, entry.raw));
  }

  async function save() {
    if (!editor || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const root = agentsRoot(editor.scope);
      new Directory(fileUriOf(root)).create({ intermediates: true, idempotent: true });
      const documentText =
        editor.mode === "raw"
          ? editor.raw
          : buildDocument({
              name: editor.name,
              description: editor.description,
              model: editor.model,
              tools: editor.tools,
              prompt: editor.prompt,
              extraEntries: editor.extraEntries,
            });
      const name = sanitizeFileName(frontText(splitFrontmatter(documentText) ?? {}, "name") ?? "");
      let target: string;
      if (name) {
        target = `${name}.md`;
      } else if (editor.relPath) {
        // 没写 name 的老文件保留原文件名（内核仍会跳过，但原文不丢）。
        target = editor.relPath;
      } else {
        setMessage("缺名称：先填上再保存");
        return;
      }
      if (editor.relPath !== target && entries.some((entry) => entry.relPath === target)) {
        setMessage(`${target} 已存在：换个名称再保存`);
        return;
      }
      await new File(fileUriOf(`${root}/${target}`)).write(documentText);
      // 改名/换作用域时删旧文件：写在成功之后再删，失败也不会丢内容。
      if (editor.relPath && editor.relPath !== target) {
        const previous = new File(fileUriOf(`${agentsRoot(editor.scope)}/${editor.relPath}`));
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
    if (!current?.relPath) return;
    const relPath = current.relPath;
    const title = agentTitle(
      entries.find((entry) => entry.relPath === relPath) ?? {
        relPath,
        fileName: relPath.split("/").pop() ?? relPath,
        name: null,
        description: null,
        model: null,
        tools: null,
        invalid: null,
        raw: "",
      },
    );
    Alert.alert(`删除「${title}」？`, "删除后不可恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void remove(relPath);
        },
      },
    ]);
  }

  async function remove(relPath: string) {
    if (!relPath) return;
    setBusy(true);
    setMessage(null);
    try {
      const file = new File(fileUriOf(`${agentsRoot(editor?.scope ?? scope)}/${relPath}`));
      if (file.exists) file.delete();
      setEditor(null);
      await load();
    } catch (error) {
      setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  /** 启用/停用 = 根目录 ↔ disabled/ 子目录之间移动文件（内核只扫目录根）。 */
  function toggleEnabled(entry: AgentEntry) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const root = agentsRoot(scope);
        const from = fileUriOf(`${root}/${entry.relPath}`);
        const toRel =
          entry.relPath.startsWith(`${DISABLED_DIR}/`)
            ? entry.relPath.slice(DISABLED_DIR.length + 1)
            : `${DISABLED_DIR}/${entry.relPath}`;
        const to = fileUriOf(`${root}/${toRel}`);
        const file = new File(from);
        if (!file.exists) return;
        new Directory(fileUriOf(`${root}/${DISABLED_DIR}`)).create({
          intermediates: true,
          idempotent: true,
        });
        const content = await file.text();
        new File(to).write(content);
        file.delete();
        await load();
      } catch (error) {
        setMessage(`切换失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(false);
      }
    })();
  }

  /** 模型下拉选中：直接改表单字段（保存时由 buildDocument 写进 frontmatter）。 */
  function applyModel(modelId: string): void {
    setEditor((current) => (current ? { ...current, model: modelId } : current));
  }

  /** 编辑器的可选模型：继承主模型 + 各供应商模型 id。 */
  const modelChoices: readonly { value: string; label: string }[] = [
    { value: "", label: "继承主模型" },
    ...providerCatalog.state.providers.flatMap((provider) =>
      provider.models.map((modelId) => ({
        value: modelId,
        label: `${provider.name} · ${modelId}`,
      })),
    ),
  ];

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
          {/* 作用域切换：用户级 / 当前项目（建了项目才可选）；与桌面端 User/Project 作用域同语义。 */}
          <AppearIn>
            <View style={styles.scopeChips}>
              <PressableScale
                scaleTo={0.94}
                onPress={() => setScope("user")}
                accessibilityRole="button"
                accessibilityLabel="用户级子智能体"
                accessibilityState={{ selected: scope === "user" }}
                style={[
                  styles.scopeChip,
                  {
                    backgroundColor: scope === "user" ? th.brandSoft : th.surfaceSoft,
                    borderColor: scope === "user" ? th.brand : th.hairline,
                  },
                ]}
              >
                <Text style={[styles.scopeChipText, { color: scope === "user" ? th.brand : th.inkSub }]}>
                  用户级
                </Text>
              </PressableScale>
              {activeProject ? (
                <PressableScale
                  scaleTo={0.94}
                  onPress={() => setScope("project")}
                  accessibilityRole="button"
                  accessibilityLabel={`当前项目的子智能体（${activeProject.name}）`}
                  accessibilityState={{ selected: scope === "project" }}
                  style={[
                    styles.scopeChip,
                    {
                      backgroundColor: scope === "project" ? th.brandSoft : th.surfaceSoft,
                      borderColor: scope === "project" ? th.brand : th.hairline,
                    },
                  ]}
                >
                  <Text
                    style={[styles.scopeChipText, { color: scope === "project" ? th.brand : th.inkSub }]}
                    numberOfLines={1}
                  >
                    项目：{activeProject.name}
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          </AppearIn>

          {editor ? (
            // 编辑器（表单）：每个字段独立控件——照桌面 SubagentsSection 的形态；
            // 「编辑原始文件」折叠给需要 effort/maxTurns 等高级键的场景。
            <AppearIn>
              <SectionCard label={editor.relPath?.split("/").pop() ?? "新建子智能体"}>
                <View style={styles.formBody}>
                  <Text style={[styles.formLabel, { color: th.inkSub }]}>名称</Text>
                  <TextInput
                    value={editor.name}
                    onChangeText={(name) => setEditor({ ...editor, name })}
                    placeholder="my-agent"
                    placeholderTextColor={th.inkFaint}
                    style={[styles.fieldInput, { color: th.ink, borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}
                  />

                  <Text style={[styles.formLabel, { color: th.inkSub }]}>何时使用</Text>
                  <TextInput
                    value={editor.description}
                    onChangeText={(description) => setEditor({ ...editor, description })}
                    placeholder="何时使用这个子智能体（一句话）"
                    placeholderTextColor={th.inkFaint}
                    style={[styles.fieldInput, { color: th.ink, borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}
                  />

                  <Text style={[styles.formLabel, { color: th.inkSub }]}>模型</Text>
                  <PressableScale
                    scaleTo={0.98}
                    onPress={() => setModelPickerOpen((value) => !value)}
                    accessibilityRole="button"
                    accessibilityLabel="选择模型"
                    style={[styles.fieldInput, styles.modelRow, { borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}
                  >
                    <Text style={[styles.fieldValue, { color: th.ink }]} numberOfLines={1}>
                      {modelChoices.find((choice) => choice.value === editor.model)?.label ?? editor.model ?? "继承主模型"}
                    </Text>
                    <Icon name="chevron-down" size={14} color={th.inkFaint} />
                  </PressableScale>
                  {modelPickerOpen
                    ? modelChoices.map((choice) => (
                        <Row
                          key={choice.value || "inherit"}
                          tone={editor.model === choice.value ? "brand" : "plain"}
                          title={choice.label}
                          onPress={() => {
                            applyModel(choice.value);
                            setModelPickerOpen(false);
                          }}
                          right={
                            editor.model === choice.value ? (
                              <Icon name="check" size={13} color={th.brand} />
                            ) : undefined
                          }
                        />
                      ))
                    : null}

                  <Text style={[styles.formLabel, { color: th.inkSub }]}>工具</Text>
                  <View style={styles.toolChips}>
                    {COMMON_TOOLS.map((tool) => {
                      const on = editor.tools.includes(tool);
                      return (
                        <PressableScale
                          key={tool}
                          scaleTo={0.94}
                          onPress={() =>
                            setEditor({
                              ...editor,
                              tools: on
                                ? editor.tools.filter((item) => item !== tool)
                                : [...editor.tools, tool],
                            })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`工具 ${tool}`}
                          accessibilityState={{ selected: on }}
                          style={[
                            styles.toolChip,
                            {
                              backgroundColor: on ? th.brandSoft : th.surfaceSoft,
                              borderColor: on ? th.brand : th.hairline,
                            },
                          ]}
                        >
                          <Text style={[styles.toolChipText, { color: on ? th.brand : th.inkSub }]}>
                            {tool}
                          </Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                  <TextInput
                    value={editor.tools.join(", ")}
                    onChangeText={(value) =>
                      setEditor({
                        ...editor,
                        tools: value
                          .split(",")
                          .map((item) => item.trim())
                          .filter((item) => item !== ""),
                      })
                    }
                    placeholder="其他工具（逗号分隔）"
                    placeholderTextColor={th.inkFaint}
                    style={[styles.fieldInput, { color: th.ink, borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}
                  />

                  <Text style={[styles.formLabel, { color: th.inkSub }]}>系统提示词</Text>
                  <TextInput
                    value={editor.prompt}
                    onChangeText={(prompt) => setEditor({ ...editor, prompt })}
                    placeholder="你是……（这个子智能体怎么做事）"
                    placeholderTextColor={th.inkFaint}
                    multiline
                    textAlignVertical="top"
                    style={[styles.fieldInput, styles.promptInput, { color: th.ink, borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}
                  />

                  <View style={styles.rawToggleRow}>
                    {dirty ? <Text style={[styles.meta, { color: th.amber }]}>未保存</Text> : null}
                    <PressableScale
                      scaleTo={0.98}
                      onPress={() =>
                        setEditor({ ...editor, mode: "raw", raw: buildDocument(editor) })
                      }
                      accessibilityRole="button"
                      accessibilityLabel="编辑原始文件"
                      style={styles.rawToggle}
                    >
                      <Text style={[styles.rawToggleText, { color: th.steel }]}>编辑原始文件…</Text>
                    </PressableScale>
                  </View>
                </View>
              </SectionCard>
            </AppearIn>
          ) : null}

          {editor ? (
            <View style={styles.actions}>
              <PillButton label="取消" variant="secondary" disabled={busy} onPress={() => setEditor(null)} />
              {editor.relPath ? (
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
                          ) : (
                            <Switch
                              value={!entry.relPath.startsWith(`${DISABLED_DIR}/`)}
                              disabled={busy}
                              onValueChange={() => toggleEnabled(entry)}
                              trackColor={{ false: th.surfaceSoft, true: th.brandSoft }}
                              thumbColor={
                                entry.relPath.startsWith(`${DISABLED_DIR}/`)
                                  ? th.inkFaint
                                  : th.brand
                              }
                              ios_backgroundColor={th.surfaceSoft}
                            />
                          )}
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
  scopeChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space(1.5),
  },
  scopeChip: {
    maxWidth: 200,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  scopeChipText: { ...text("micro"), fontWeight: "600" },
  formBody: { paddingHorizontal: space(3.5), paddingVertical: space(2.5), gap: space(2) },
  formLabel: { ...text("micro"), fontWeight: "600" },
  fieldInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    ...text("body"),
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldValue: { flex: 1, ...text("body") },
  toolChips: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  toolChip: {
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  toolChipText: { ...text("micro"), fontWeight: "600" },
  promptInput: { minHeight: 200 },
  rawToggleRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: space(3),
  },
  rawToggle: { paddingVertical: space(1) },
  rawToggleText: { ...text("micro"), fontWeight: "600" },
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
