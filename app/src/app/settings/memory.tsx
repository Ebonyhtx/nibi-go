// 本机记忆设置：自动记忆按会话的工作区（项目）分目录（与桌面端同一口径）。
// 内核按每次请求的 workspace 解析 <cli>/memories/projects/<slug>-<sha256前16位>/memory；
// GO 的 HOME = filesDir = Paths.document，App 直接读同一份目录（本页的文件浏览器）。
//
// 写入机制（对齐 kernel/crates/runtime/src/memory.rs）：**回合结束后**内核以
// 后台侧模型调用（QuerySource::Side "project_memory_extract"）跑一次抽取，带自己的
// 记忆工具写 md 文件——不经过主对话，所以消息流里看不到「写记忆」工具行；
// 抽取是否发生由 evaluate_extraction（消息量等）决定，开关只在会话物化时交给内核
// （session/requestRuntimePreferences.memoryEnabled），已打开的会话要重开才生效。
// 体量/清空复用 kernel 的 sessionData/measure|purge。
// 2.0：ScreenHeader + SectionCard 统一；2.2：新增记忆文件浏览器（运营者 2026-11-22
// 要求像桌面端一样能看每个项目的记忆文件内容）。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Paths } from "expo-file-system";

import { Icon } from "../../components/Icon";
import { MessageMarkdown } from "../../components/MessageMarkdown";
import { Row } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { currentKernelClient } from "../../kernel/kernelRegistry";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { PressableScale } from "../../motion/PressableScale";
import { clearMemory, measureMemory, type MemoryUsageEntry } from "../../memory/usage";
import { useMemoryPreferences } from "../../memory/useMemoryPreferences";
import { useProjects } from "../../kernel/projects";
import { documentRootOf, projectIdOfWorkspace } from "../../kernel/workspace";
import { radius, size, space, text, useNibiTheme } from "../../theme";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 记忆文件里的单个 md。 */
interface MemoryFileEntry {
  name: string;
  size: number;
  modifiedAt?: number;
}

/** 一个项目记忆目录（<slug>-<16 位 hash>）。 */
interface MemoryProjectEntry {
  key: string;
  /** 目录名解析出的展示名：能对上项目 id 就显示项目名。 */
  label: string;
  files: MemoryFileEntry[];
}

/** 目录名 → 展示名：<slug>-<sha256前16位>；slug 能对上项目 id 就用项目名。 */
function memoryProjectLabel(
  dirName: string,
  projects: readonly { id: string; name: string }[],
): string {
  const match = /^(.*)-[0-9a-f]{16}$/u.exec(dirName);
  const slug = match?.[1] ?? dirName;
  const project = projects.find((entry) => entry.id === slug);
  if (project) return project.name;
  if (slug === "project") return "工作区";
  return slug.length > 24 ? `${slug.slice(0, 24)}…` : slug;
}

export default function MemorySettingsScreen() {
  const th = useNibiTheme();
  const projects = useProjects();
  const insets = useSafeAreaInsets();
  const { preferences, setEnabled } = useMemoryPreferences();
  const [entries, setEntries] = useState<MemoryUsageEntry[]>([]);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 记忆文件浏览器
  const [memoryProjects, setMemoryProjects] = useState<MemoryProjectEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  const [viewing, setViewing] = useState<{ name: string; text: string; raw: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const client = currentKernelClient();
    if (!client) {
      setMessage("内核会话还没就绪：先回首页打开一个会话，再回来查看。");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const usage = await measureMemory(client);
      setEntries(usage.entries);
      setTotalBytes(usage.totalBytes);
    } catch (error) {
      setMessage(`读取记忆体量失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  /** 扫 HOME/memories/projects/<slug>-<hash>/memory/*.md（口径见 kernel memory/root.rs）。 */
  const refreshMemoryFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const { Directory, File, Paths: FsPaths } = await import("expo-file-system");
      // 内核 HOME=filesDir、storage root=~/.nibi、cli_root=<root>/cli —— 记忆实际在
      // <filesDir>/.nibi/cli/memories/projects/<slug>-<hash>/memory（曾按 filesDir 直下
      // 扫而看不到文件，运营者 2026-11-22 现场抓包）。
      const base = new Directory(FsPaths.document, ".nibi", "cli", "memories", "projects");
      const projectsFound: MemoryProjectEntry[] = [];
      if (base.exists) {
        for (const entry of base.list()) {
          if (!(entry instanceof Directory)) continue;
          const memoryDir = new Directory(entry, "memory");
          if (!memoryDir.exists) continue;
          const files: MemoryFileEntry[] = [];
          for (const child of memoryDir.list()) {
            if (!(child instanceof File) || !child.name.endsWith(".md")) continue;
            files.push({
              name: child.name,
              size: child.size ?? 0,
              modifiedAt: child.modificationTime ?? undefined,
            });
          }
          if (files.length === 0) continue;
          files.sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0));
          projectsFound.push({
            key: entry.name,
            label: memoryProjectLabel(entry.name, projects.projects),
            files,
          });
        }
      }
      projectsFound.sort((left, right) => left.label.localeCompare(right.label));
      setMemoryProjects(projectsFound);
      setSelectedProject((current) =>
        current && projectsFound.some((entry) => entry.key === current)
          ? current
          : (projectsFound[0]?.key ?? null),
      );
    } catch {
      setMemoryProjects([]);
    } finally {
      setFilesLoading(false);
    }
  }, [projects.projects]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void refreshMemoryFiles();
    }, [refresh, refreshMemoryFiles]),
  );

  const activeProject = useMemo(
    () => memoryProjects.find((entry) => entry.key === selectedProject) ?? null,
    [memoryProjects, selectedProject],
  );
  const visibleFiles = useMemo(() => {
    const list = activeProject?.files ?? [];
    const needle = fileQuery.trim().toLocaleLowerCase();
    return needle.length === 0
      ? list
      : list.filter((file) => file.name.toLocaleLowerCase().includes(needle));
  }, [activeProject, fileQuery]);

  const openMemoryFile = useCallback((projectKey: string, file: MemoryFileEntry) => {
    void (async () => {
      if (file.size > 512 * 1024) {
        setMessage("文件超过 512KB，暂不打开。");
        return;
      }
      try {
        const { Directory, File, Paths: FsPaths } = await import("expo-file-system");
        const handle = new File(
          new Directory(FsPaths.document, ".nibi", "cli", "memories", "projects", projectKey, "memory"),
          file.name,
        );
        const content = await handle.text();
        setViewing({ name: file.name, text: content, raw: false });
      } catch (error) {
        setMessage(`读取失败：${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, []);

  function confirmClear() {
    const client = currentKernelClient();
    if (!client) {
      setMessage("内核会话还没就绪：先回首页打开一个会话，再回来清空。");
      return;
    }
    Alert.alert(
      "清空本机记忆？",
      "会删除所有会话共享的记忆文件，不删除会话本身。已经打开的会话仍持有内存里的记忆，重新打开后才完全消失。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "清空",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            setMessage(null);
            void clearMemory(client)
              .then((bytes) => {
                setMessage(`已清空本机记忆（释放 ${formatBytes(bytes)}）`);
                setEntries([]);
                setTotalBytes(0);
              })
              .catch((error: unknown) => {
                setMessage(
                  `清空失败：${error instanceof Error ? error.message : String(error)}`,
                );
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="记忆" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        {/* 2.0.1：说明段压成一句。内核按 workspace 分项目记忆（2026-11-21 运营者报告后修正）。 */}
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <Text style={[styles.intro, { color: th.inkSub }]}>
            记忆按会话的工作区（项目）分开保存：回合结束后内核自动抽取写入 md 文件（后台
            侧模型调用，不经主对话，所以消息流里看不到「写记忆」工具行）。
          </Text>
        </AppearIn>

        <AppearIn delay={staggerDelay(1, 32, 240)}>
          <SectionCard>
            <Row
              icon="sparkles"
              tone="brand"
              title="启用本机记忆"
              detail="关闭后新会话不再读写记忆"
              // 右槽直接放 Switch（与 ui/ToggleRow 同一配色）；写回逻辑保持原样（保存即提示）。
              right={
                <Switch
                  value={preferences.enabled}
                  onValueChange={(enabled) => {
                    setEnabled(enabled);
                    setMessage("记忆设置已保存；对下一个新会话生效。");
                  }}
                  trackColor={{ false: th.surfaceSoft, true: th.brandSoft }}
                  thumbColor={preferences.enabled ? th.brand : th.inkFaint}
                  ios_backgroundColor={th.surfaceSoft}
                />
              }
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(2, 32, 240)}>
          <SectionCard label="已保存的记忆">
            <View style={styles.usageHead}>
              {totalBytes === null ? (
                <Text style={[styles.usageStatus, { color: th.inkFaint }]}>正在读取…</Text>
              ) : totalBytes === 0 ? (
                <Text style={[styles.usageStatus, { color: th.inkFaint }]}>还没有保存记忆。</Text>
              ) : (
                <Text style={[styles.total, { color: th.ink }]}>{formatBytes(totalBytes)}</Text>
              )}
              <PressableScale
                onPress={() => void refresh()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="刷新记忆体量"
                style={[styles.refresh, { backgroundColor: th.surfaceSoft }, busy ? styles.busy : null]}
              >
                {busy ? (
                  <ActivityIndicator color={th.brand} size="small" />
                ) : (
                  <Icon name="refresh" size={14} color={th.inkSub} />
                )}
              </PressableScale>
            </View>
            {totalBytes !== null && totalBytes > 0 ? (
              <View style={styles.usageEntries}>
                {entries.map((entry) => {
                  const root = documentRootOf(Paths.document.uri);
                  const projectId = projectIdOfWorkspace(root, entry.workspacePath);
                  const projectName = projectId
                    ? (projects.projects.find((entry2) => entry2.id === projectId)?.name ?? projectId)
                    : entry.workspacePath.split("/").filter(Boolean).pop() ?? entry.workspacePath;
                  return (
                    <Text key={entry.workspacePath} style={[styles.usageEntry, { color: th.inkFaint }]}>
                      {projectName} · {formatBytes(entry.bytes)}
                    </Text>
                  );
                })}
              </View>
            ) : null}
            <Divider />
            <Row
              icon="trash"
              danger
              title="清空本机记忆"
              detail="删除全部记忆，不影响会话"
              onPress={confirmClear}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(3, 32, 240)}>
          <SectionCard label="记忆文件">
            {viewing ? (
              // 文件查看层：返回 + 文件名 + 原文切换（桌面端记忆文件浏览同款语义）
              <View style={styles.fileViewer}>
                <View style={styles.fileViewerHead}>
                  <Pressable
                    onPress={() => setViewing(null)}
                    accessibilityRole="button"
                    accessibilityLabel="返回记忆文件列表"
                    hitSlop={6}
                    style={styles.fileViewerBack}
                  >
                    <Icon name="chevron-left" size={14} color={th.inkSub} />
                    <Text style={[styles.fileViewerBackText, { color: th.inkSub }]}>列表</Text>
                  </Pressable>
                  <Text style={[styles.fileViewerTitle, { color: th.ink }]} numberOfLines={1}>
                    {viewing.name}
                  </Text>
                  <Pressable
                    onPress={() => setViewing({ ...viewing, raw: !viewing.raw })}
                    accessibilityRole="button"
                    accessibilityLabel={viewing.raw ? "渲染预览" : "查看原文"}
                    hitSlop={6}
                  >
                    <Text style={[styles.fileViewerToggle, { color: th.brand }]}>
                      {viewing.raw ? "预览" : "原文"}
                    </Text>
                  </Pressable>
                </View>
                <View style={[styles.fileViewerBody, { borderTopColor: th.hairline }]}>
                  {viewing.raw ? (
                    <Text style={[styles.fileViewerRaw, { color: th.inkSub }]}>{viewing.text}</Text>
                  ) : (
                    <MessageMarkdown text={viewing.text} />
                  )}
                </View>
              </View>
            ) : (
              <>
                {memoryProjects.length > 0 ? (
                  <View style={styles.fileChips}>
                    {memoryProjects.map((entry) => {
                      const active = entry.key === selectedProject;
                      return (
                        <PressableScale
                          key={entry.key}
                          scaleTo={0.94}
                          onPress={() => setSelectedProject(entry.key)}
                          accessibilityRole="button"
                          accessibilityLabel={`查看 ${entry.label} 的记忆文件`}
                          accessibilityState={{ selected: active }}
                          style={[
                            styles.fileChip,
                            {
                              backgroundColor: active ? th.brandSoft : th.surfaceSoft,
                              borderColor: active ? th.brand : th.hairline,
                            },
                          ]}
                        >
                          <Text
                            style={[styles.fileChipText, { color: active ? th.brand : th.inkSub }]}
                            numberOfLines={1}
                          >
                            {entry.label}
                          </Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                ) : null}
                {memoryProjects.length > 0 ? (
                  <View
                    style={[
                      styles.fileSearch,
                      { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
                    ]}
                  >
                    <Icon name="search" size={12} color={th.inkGhost} />
                    <TextInput
                      value={fileQuery}
                      onChangeText={setFileQuery}
                      placeholder="搜索记忆文件…"
                      placeholderTextColor={th.inkFaint}
                      autoCorrect={false}
                      autoCapitalize="none"
                      style={[styles.fileSearchInput, { color: th.ink }]}
                    />
                    <Pressable
                      onPress={() => void refreshMemoryFiles()}
                      accessibilityRole="button"
                      accessibilityLabel="刷新记忆文件"
                      hitSlop={6}
                    >
                      <Icon name="refresh" size={13} color={th.inkSub} />
                    </Pressable>
                  </View>
                ) : null}
                {filesLoading ? (
                  <View style={styles.filesPlaceholder}>
                    <ActivityIndicator color={th.brand} size="small" />
                    <Text style={[styles.filesPlaceholderText, { color: th.inkFaint }]}>
                      正在扫描记忆目录…
                    </Text>
                  </View>
                ) : memoryProjects.length === 0 ? (
                  <Text style={[styles.filesPlaceholderText, { color: th.inkFaint, padding: space(3.5) }]}>
                    还没有记忆文件。开启记忆并完成几个回合后，内核会在后台自动写入；每个项目
                    一个目录。
                  </Text>
                ) : visibleFiles.length === 0 ? (
                  <Text style={[styles.filesPlaceholderText, { color: th.inkFaint, padding: space(3.5) }]}>
                    {fileQuery.trim() ? "没有匹配的文件" : "这个项目还没有记忆文件"}
                  </Text>
                ) : (
                  <View>
                    {visibleFiles.map((file) => (
                      <Pressable
                        key={file.name}
                        onPress={() => selectedProject && openMemoryFile(selectedProject, file)}
                        accessibilityRole="button"
                        accessibilityLabel={`查看记忆文件 ${file.name}`}
                        style={({ pressed }) => [
                          styles.fileRow,
                          pressed ? { backgroundColor: th.hover } : null,
                        ]}
                      >
                        <Icon name="doc" size={14} color={th.inkSub} />
                        <View style={styles.fileRowText}>
                          <Text style={[styles.fileRowName, { color: th.ink }]} numberOfLines={1}>
                            {file.name}
                          </Text>
                          <Text style={[styles.fileRowMeta, { color: th.inkFaint }]}>
                            {typeof file.modifiedAt === "number"
                              ? new Date(file.modifiedAt).toLocaleString()
                              : "—"}
                            {" · "}
                            {formatBytes(file.size)}
                          </Text>
                        </View>
                        <Icon name="chevron-right" size={13} color={th.inkGhost} />
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(4, 32, 240)}>
          <SectionCard>
            <Row
              icon="info"
              tone="steel"
              title="诊断"
              detail="用量与网络状态"
              onPress={() => router.push("/settings/diagnostics")}
            />
          </SectionCard>
        </AppearIn>

        {message ? (
          <AppearIn delay={staggerDelay(5, 32, 240)}>
            <View style={[styles.message, { backgroundColor: th.card, borderColor: th.hairline }]}>
              <Text style={[styles.messageText, { color: th.inkSub }]}>{message}</Text>
            </View>
          </AppearIn>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(3) },
  intro: { ...text("small") },
  usageHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(3.5),
    paddingVertical: space(2),
  },
  usageStatus: { flex: 1, ...text("small") },
  total: { flex: 1, ...text("title"), fontWeight: "700" },
  usageEntries: {
    gap: space(1),
    paddingHorizontal: space(3.5),
    paddingBottom: space(1.5),
  },

  usageEntry: { ...text("micro") },
  refresh: {
    width: size.chip,
    height: size.chip,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  busy: { opacity: 0.6 },
  // 记忆文件浏览器
  fileChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space(1.5),
    paddingHorizontal: space(3.5),
    paddingTop: space(2.5),
  },
  fileChip: {
    maxWidth: 160,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  fileChipText: { ...text("micro"), fontWeight: "600" },
  fileSearch: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    marginHorizontal: space(3.5),
    marginTop: space(2),
    marginBottom: space(1),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileSearchInput: { flex: 1, ...text("small"), padding: 0 },
  filesPlaceholder: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    padding: space(3.5),
  },
  filesPlaceholderText: { ...text("small"), flexShrink: 1 },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    paddingHorizontal: space(3.5),
    paddingVertical: space(2),
  },
  fileRowText: { flex: 1, minWidth: 0, gap: 2 },
  fileRowName: { ...text("small"), fontWeight: "600" },
  fileRowMeta: { ...text("micro") },
  fileViewer: {},
  fileViewerHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
  },
  fileViewerBack: { flexDirection: "row", alignItems: "center", gap: space(0.5) },
  fileViewerBackText: { ...text("micro"), fontWeight: "600" },
  fileViewerTitle: { flex: 1, ...text("small"), fontWeight: "700" },
  fileViewerToggle: { ...text("micro"), fontWeight: "700" },
  fileViewerBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
  },
  fileViewerRaw: { ...text("small"), fontFamily: "monospace", lineHeight: 18 },
  message: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
  },
  messageText: { ...text("small") },
});
