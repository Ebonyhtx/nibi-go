// 本机记忆设置：自动记忆按会话的工作区（项目）分目录（与桌面端同一口径）。
// 内核按每次请求的 workspace 解析 <cli>/memories/projects/<slug>-<sha256前16位>/memory；
// GO 的 HOME = filesDir = Paths.document，App 直接读同一份目录（本页的文件浏览器）。
//
// 写入机制（对齐 kernel/crates/runtime/src/memory.rs）：**回合结束后**内核以
// 后台侧模型调用（QuerySource::Side "project_memory_extract"）跑一次抽取，带自己的
// 记忆工具写 md 文件——不经过主对话，所以消息流里看不到「写记忆」工具行；
// 抽取是否发生由 evaluate_extraction（消息量等）决定，开关只在会话物化时交给内核
// （session/requestRuntimePreferences.memoryEnabled），已打开的会话要重开才生效。
// 体量/清空复用 kernel 的 sessionData/measure|purge 并同步清理磁盘记忆目录。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
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

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Icon } from "../../components/Icon";
import { MessageMarkdown } from "../../components/MessageMarkdown";
import { PillButton } from "../../components/ui/PillButton";
import { Row } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { currentKernelClient } from "../../kernel/kernelRegistry";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { haptic } from "../../motion/haptics";
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
  totalBytes: number;
}

type ConfirmAction =
  | { kind: "clearAll" }
  | { kind: "clearProject"; projectKey: string; projectLabel: string; count: number }
  | { kind: "deleteSelected"; projectKey: string; names: string[] }
  | { kind: "deleteSingle"; projectKey: string; fileName: string };

/** 目录名 → 展示名：<slug>-<sha256前16位>；slug 能对上项目 id 就用项目名。 */
function memoryProjectLabel(
  dirName: string,
  projects: readonly { id: string; name: string }[],
): string {
  const match = /^(.*)-[0-9a-f]{16}$/u.exec(dirName);
  const slug = match?.[1] ?? dirName;
  const project = projects.find((entry) => entry.id === slug);
  if (project) return project.name;
  if (slug === "project") return "默认工作区";
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

  // 记忆文件浏览器与精细化管理
  const [memoryProjects, setMemoryProjects] = useState<MemoryProjectEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  const [viewing, setViewing] = useState<{
    projectKey: string;
    name: string;
    text: string;
    raw: boolean;
    editing: boolean;
    draft: string;
  } | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set());
  const [confirmTarget, setConfirmTarget] = useState<ConfirmAction | null>(null);

  /** 扫 HOME/.nibi/cli/memories/projects/<slug>-<hash>/memory/*.md（口径见 kernel memory/root.rs）。 */
  const refreshMemoryFiles = useCallback(async (): Promise<MemoryProjectEntry[]> => {
    setFilesLoading(true);
    try {
      const { Directory, File, Paths: FsPaths } = await import("expo-file-system");
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
          const projectBytes = files.reduce((sum, item) => sum + item.size, 0);
          projectsFound.push({
            key: entry.name,
            label: memoryProjectLabel(entry.name, projects.projects),
            files,
            totalBytes: projectBytes,
          });
        }
      }
      projectsFound.sort((left, right) => left.label.localeCompare(right.label));
      setMemoryProjects(projectsFound);
      setSelectedProject((current) => {
        const next =
          current && projectsFound.some((entry) => entry.key === current)
            ? current
            : (projectsFound[0]?.key ?? null);
        if (next !== current) {
          setSelectedFiles(new Set());
        }
        return next;
      });
      return projectsFound;
    } catch {
      setMemoryProjects([]);
      return [];
    } finally {
      setFilesLoading(false);
    }
  }, [projects.projects]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const diskProjects = await refreshMemoryFiles();
      const diskBytes = diskProjects.reduce((sum, item) => sum + item.totalBytes, 0);
      const client = currentKernelClient();
      if (client) {
        try {
          const usage = await measureMemory(client);
          setEntries(usage.entries);
          setTotalBytes(Math.max(usage.totalBytes, diskBytes));
        } catch {
          setEntries([]);
          setTotalBytes(diskBytes);
        }
      } else {
        setEntries([]);
        setTotalBytes(diskBytes);
      }
    } finally {
      setBusy(false);
    }
  }, [refreshMemoryFiles]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
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
          new Directory(
            FsPaths.document,
            ".nibi",
            "cli",
            "memories",
            "projects",
            projectKey,
            "memory",
          ),
          file.name,
        );
        const content = await handle.text();
        setViewing({
          projectKey,
          name: file.name,
          text: content,
          raw: false,
          editing: false,
          draft: content,
        });
      } catch (error) {
        setMessage(`读取失败：${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, []);

  const saveViewingFile = useCallback(async () => {
    if (!viewing) return;
    setBusy(true);
    try {
      const { Directory, File, Paths: FsPaths } = await import("expo-file-system");
      const handle = new File(
        new Directory(
          FsPaths.document,
          ".nibi",
          "cli",
          "memories",
          "projects",
          viewing.projectKey,
          "memory",
        ),
        viewing.name,
      );
      await handle.write(viewing.draft);
      setViewing({
        ...viewing,
        text: viewing.draft,
        editing: false,
      });
      setMessage(`已保存 ${viewing.name}`);
      await refresh();
    } catch (error) {
      setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [refresh, viewing]);

  const toggleFileSelection = (name: string) => {
    haptic("tick");
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    haptic("tick");
    const allSelected =
      visibleFiles.length > 0 && visibleFiles.every((file) => selectedFiles.has(file.name));
    if (allSelected) {
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        for (const file of visibleFiles) next.delete(file.name);
        return next;
      });
    } else {
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        for (const file of visibleFiles) next.add(file.name);
        return next;
      });
    }
  };

  /** 执行删除动作：同时清理磁盘记忆目录与内核测量状态，并立即刷新文件列表。 */
  const executeConfirmAction = async (action: ConfirmAction) => {
    setConfirmTarget(null);
    setBusy(true);
    setMessage(null);
    try {
      const { Directory, File, Paths: FsPaths } = await import("expo-file-system");
      const base = new Directory(FsPaths.document, ".nibi", "cli", "memories", "projects");

      if (action.kind === "clearAll") {
        let released = 0;
        const client = currentKernelClient();
        if (client) {
          try {
            released += await clearMemory(client);
          } catch {
            // 内核未打开会话或清理部分失败时仍由下方磁盘全量清理兜底。
          }
        }
        if (base.exists) {
          for (const entry of base.list()) {
            if (entry instanceof Directory) {
              const memoryDir = new Directory(entry, "memory");
              if (memoryDir.exists) {
                for (const child of memoryDir.list()) {
                  if (child instanceof File) released += child.size ?? 0;
                }
              }
              entry.delete();
            }
          }
        }
        setViewing(null);
        setBatchMode(false);
        setSelectedFiles(new Set());
        setEntries([]);
        setTotalBytes(0);
        setMemoryProjects([]);
        setSelectedProject(null);
        await refresh();
        setMessage(
          released > 0 ? `已清空全部本机记忆（释放 ${formatBytes(released)}）` : "已清空全部本机记忆",
        );
        return;
      }

      if (action.kind === "clearProject") {
        const projDir = new Directory(base, action.projectKey);
        let released = 0;
        if (projDir.exists) {
          const memoryDir = new Directory(projDir, "memory");
          if (memoryDir.exists) {
            for (const child of memoryDir.list()) {
              if (child instanceof File) released += child.size ?? 0;
            }
          }
          projDir.delete();
        }
        if (viewing?.projectKey === action.projectKey) setViewing(null);
        setBatchMode(false);
        setSelectedFiles(new Set());
        await refresh();
        setMessage(
          `已清空「${action.projectLabel}」的 ${action.count} 个记忆文件（释放 ${formatBytes(released)}）`,
        );
        return;
      }

      const targetNames =
        action.kind === "deleteSingle" ? [action.fileName] : action.names;
      const memoryDir = new Directory(base, action.projectKey, "memory");
      let deletedCount = 0;
      let released = 0;
      if (memoryDir.exists) {
        for (const fileName of targetNames) {
          const targetFile = new File(memoryDir, fileName);
          if (targetFile.exists) {
            released += targetFile.size ?? 0;
            targetFile.delete();
            deletedCount += 1;
          }
        }
        // 若删的是非 MEMORY.md 条目，顺手从同目录 MEMORY.md 索引里移除对应指针行，避免留悬空索引。
        if (!targetNames.includes("MEMORY.md")) {
          const indexFile = new File(memoryDir, "MEMORY.md");
          if (indexFile.exists) {
            try {
              const rawIndex = await indexFile.text();
              const filteredLines = rawIndex
                .split(/\r?\n/u)
                .filter(
                  (line) =>
                    !targetNames.some((deletedName) => line.includes(`(${deletedName})`)),
                );
              await indexFile.write(filteredLines.join("\n"));
            } catch {
              // 索引更新失败不影响文件本身删除。
            }
          }
        }
        // 如果该项目的记忆文件已全部删完，顺手清理空目录。
        const remainingMd = memoryDir
          .list()
          .filter((child) => child instanceof File && child.name.endsWith(".md"));
        if (remainingMd.length === 0) {
          const projDir = new Directory(base, action.projectKey);
          if (projDir.exists) projDir.delete();
        }
      }

      if (viewing && viewing.projectKey === action.projectKey && targetNames.includes(viewing.name)) {
        setViewing(null);
      }
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        for (const name of targetNames) next.delete(name);
        return next;
      });
      if (action.kind === "deleteSelected") setBatchMode(false);
      await refresh();
      setMessage(
        deletedCount > 1
          ? `已批量删除 ${deletedCount} 个记忆文件（释放 ${formatBytes(released)}）`
          : `已删除 ${targetNames[0] ?? "记忆文件"}（释放 ${formatBytes(released)}）`,
      );
    } catch (error) {
      setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const allVisibleSelected =
    visibleFiles.length > 0 && visibleFiles.every((file) => selectedFiles.has(file.name));
  const diskTotalBytes = useMemo(
    () => memoryProjects.reduce((sum, item) => sum + item.totalBytes, 0),
    [memoryProjects],
  );
  const shownTotalBytes = totalBytes === null ? null : Math.max(totalBytes, diskTotalBytes);

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
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <Text style={[styles.intro, { color: th.inkSub }]}>
            记忆按会话的工作区（项目）分开保存：回合结束后内核自动抽取写入 Markdown 文件，可在此按条查看、编辑、批量删除或按项目清理。
          </Text>
        </AppearIn>

        <AppearIn delay={staggerDelay(1, 32, 240)}>
          <SectionCard>
            <Row
              icon="sparkles"
              tone="brand"
              title="启用本机记忆"
              detail="关闭后新会话不再读写记忆"
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
              {shownTotalBytes === null ? (
                <Text style={[styles.usageStatus, { color: th.inkFaint }]}>正在读取…</Text>
              ) : shownTotalBytes === 0 && memoryProjects.length === 0 ? (
                <Text style={[styles.usageStatus, { color: th.inkFaint }]}>还没有保存记忆。</Text>
              ) : (
                <View style={styles.usageTotalCol}>
                  <Text style={[styles.total, { color: th.ink }]}>
                    {formatBytes(shownTotalBytes)}
                  </Text>
                  <Text style={[styles.usageSub, { color: th.inkFaint }]}>
                    共 {memoryProjects.length} 个项目 ·{" "}
                    {memoryProjects.reduce((sum, item) => sum + item.files.length, 0)} 个记忆文件
                  </Text>
                </View>
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
            {memoryProjects.length > 0 ? (
              <View style={styles.usageEntries}>
                {memoryProjects.map((proj) => (
                  <Text key={proj.key} style={[styles.usageEntry, { color: th.inkFaint }]}>
                    {proj.label} · {proj.files.length} 项 · {formatBytes(proj.totalBytes)}
                  </Text>
                ))}
              </View>
            ) : entries.length > 0 ? (
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
              title="清空全部本机记忆"
              detail="删除所有项目的全部记忆文件，不影响会话记录"
              onPress={() => setConfirmTarget({ kind: "clearAll" })}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(3, 32, 240)}>
          <SectionCard label="记忆文件管理">
            {viewing ? (
              // 文件查看与编辑层：返回 + 文件名 + 预览/原文/编辑/删除
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
                  {viewing.editing ? (
                    <View style={styles.viewerActionRow}>
                      <Pressable
                        onPress={() =>
                          setViewing({ ...viewing, editing: false, draft: viewing.text })
                        }
                        hitSlop={6}
                      >
                        <Text style={[styles.fileViewerToggle, { color: th.inkSub }]}>取消</Text>
                      </Pressable>
                      <Pressable onPress={() => void saveViewingFile()} hitSlop={6}>
                        <Text style={[styles.fileViewerToggle, { color: th.brand }]}>保存</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.viewerActionRow}>
                      <Pressable
                        onPress={() => setViewing({ ...viewing, raw: !viewing.raw })}
                        accessibilityRole="button"
                        accessibilityLabel={viewing.raw ? "渲染预览" : "查看原文"}
                        hitSlop={6}
                      >
                        <Text style={[styles.fileViewerToggle, { color: th.inkSub }]}>
                          {viewing.raw ? "预览" : "原文"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          setViewing({ ...viewing, editing: true, draft: viewing.text })
                        }
                        accessibilityRole="button"
                        accessibilityLabel="编辑记忆文件"
                        hitSlop={6}
                      >
                        <Text style={[styles.fileViewerToggle, { color: th.brand }]}>编辑</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          setConfirmTarget({
                            kind: "deleteSingle",
                            projectKey: viewing.projectKey,
                            fileName: viewing.name,
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`删除 ${viewing.name}`}
                        hitSlop={6}
                      >
                        <Icon name="trash" size={14} color={th.red} />
                      </Pressable>
                    </View>
                  )}
                </View>
                <View style={[styles.fileViewerBody, { borderTopColor: th.hairline }]}>
                  {viewing.editing ? (
                    <TextInput
                      value={viewing.draft}
                      onChangeText={(draft) => setViewing({ ...viewing, draft })}
                      multiline
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[
                        styles.fileViewerInput,
                        {
                          color: th.ink,
                          backgroundColor: th.surfaceSoft,
                          borderColor: th.hairlineStrong,
                        },
                      ]}
                    />
                  ) : viewing.raw ? (
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
                          onPress={() => {
                            setSelectedProject(entry.key);
                            setSelectedFiles(new Set());
                          }}
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
                            {entry.label} ({entry.files.length})
                          </Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                ) : null}

                {memoryProjects.length > 0 ? (
                  <View style={styles.toolbarWrap}>
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
                      {fileQuery.length > 0 ? (
                        <Pressable
                          onPress={() => setFileQuery("")}
                          accessibilityRole="button"
                          accessibilityLabel="清除搜索"
                          hitSlop={6}
                        >
                          <Icon name="x" size={12} color={th.inkGhost} />
                        </Pressable>
                      ) : null}
                    </View>
                    <PressableScale
                      scaleTo={0.95}
                      onPress={() => {
                        haptic("tick");
                        setBatchMode((current) => {
                          if (current) setSelectedFiles(new Set());
                          return !current;
                        });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={batchMode ? "退出批量管理" : "批量管理记忆文件"}
                      style={[
                        styles.manageToggle,
                        {
                          backgroundColor: batchMode ? th.brandSoft : th.surfaceSoft,
                          borderColor: batchMode ? th.brand : th.hairline,
                        },
                      ]}
                    >
                      <Icon
                        name="checklist"
                        size={12}
                        color={batchMode ? th.brand : th.inkSub}
                      />
                      <Text
                        style={[
                          styles.manageToggleText,
                          { color: batchMode ? th.brand : th.inkSub },
                        ]}
                      >
                        {batchMode ? "完成" : "批量管理"}
                      </Text>
                    </PressableScale>
                  </View>
                ) : null}

                {batchMode && activeProject && visibleFiles.length > 0 ? (
                  <View
                    style={[
                      styles.batchBar,
                      { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
                    ]}
                  >
                    <Pressable
                      onPress={toggleSelectAllVisible}
                      accessibilityRole="button"
                      accessibilityLabel={allVisibleSelected ? "取消全选" : "全选"}
                      style={styles.selectAllBtn}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            backgroundColor: allVisibleSelected ? th.brand : th.card,
                            borderColor: allVisibleSelected ? th.brand : th.hairlineStrong,
                          },
                        ]}
                      >
                        {allVisibleSelected ? (
                          <Icon name="check" size={10} color={th.brandFg} strokeWidth={2.6} />
                        ) : null}
                      </View>
                      <Text style={[styles.selectAllText, { color: th.ink }]}>
                        {allVisibleSelected ? "取消全选" : "全选"}
                      </Text>
                    </Pressable>
                    <View style={styles.batchActions}>
                      <PillButton
                        label="清空此项目"
                        variant="secondary"
                        buttonSize="sm"
                        onPress={() =>
                          setConfirmTarget({
                            kind: "clearProject",
                            projectKey: activeProject.key,
                            projectLabel: activeProject.label,
                            count: activeProject.files.length,
                          })
                        }
                      />
                      <PillButton
                        label={
                          selectedFiles.size > 0
                            ? `删除选中 (${selectedFiles.size})`
                            : "删除选中"
                        }
                        variant="danger"
                        buttonSize="sm"
                        disabled={selectedFiles.size === 0}
                        onPress={() =>
                          setConfirmTarget({
                            kind: "deleteSelected",
                            projectKey: activeProject.key,
                            names: [...selectedFiles],
                          })
                        }
                      />
                    </View>
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
                    还没有记忆文件。开启记忆并完成几个回合后，内核会在后台自动写入；每个项目一个目录。
                  </Text>
                ) : visibleFiles.length === 0 ? (
                  <Text style={[styles.filesPlaceholderText, { color: th.inkFaint, padding: space(3.5) }]}>
                    {fileQuery.trim() ? "没有匹配的文件" : "这个项目还没有记忆文件"}
                  </Text>
                ) : (
                  <View>
                    {visibleFiles.map((file) => {
                      const checked = selectedFiles.has(file.name);
                      return (
                        <View
                          key={file.name}
                          style={[
                            styles.fileRow,
                            checked && batchMode ? { backgroundColor: th.brandSoft } : null,
                          ]}
                        >
                          <Pressable
                            onPress={() => {
                              if (batchMode) {
                                toggleFileSelection(file.name);
                              } else if (selectedProject) {
                                openMemoryFile(selectedProject, file);
                              }
                            }}
                            onLongPress={() => {
                              haptic("longPress");
                              if (!batchMode) setBatchMode(true);
                              toggleFileSelection(file.name);
                            }}
                            delayLongPress={320}
                            accessibilityRole="button"
                            accessibilityLabel={
                              batchMode ? `选择记忆文件 ${file.name}` : `查看记忆文件 ${file.name}`
                            }
                            style={({ pressed }) => [
                              styles.fileRowMain,
                              pressed ? { opacity: 0.78 } : null,
                            ]}
                          >
                            {batchMode ? (
                              <View
                                style={[
                                  styles.checkbox,
                                  {
                                    backgroundColor: checked ? th.brand : th.card,
                                    borderColor: checked ? th.brand : th.hairlineStrong,
                                  },
                                ]}
                              >
                                {checked ? (
                                  <Icon
                                    name="check"
                                    size={10}
                                    color={th.brandFg}
                                    strokeWidth={2.6}
                                  />
                                ) : null}
                              </View>
                            ) : (
                              <Icon name="doc" size={14} color={th.inkSub} />
                            )}
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
                            {!batchMode ? (
                              <Icon name="chevron-right" size={13} color={th.inkGhost} />
                            ) : null}
                          </Pressable>
                          {!batchMode && selectedProject ? (
                            <Pressable
                              onPress={() => {
                                haptic("tick");
                                setConfirmTarget({
                                  kind: "deleteSingle",
                                  projectKey: selectedProject,
                                  fileName: file.name,
                                });
                              }}
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel={`删除记忆文件 ${file.name}`}
                              style={[
                                styles.rowDeleteBtn,
                                { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
                              ]}
                            >
                              <Icon name="trash" size={12} color={th.red} />
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    })}
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

      <ConfirmDialog
        visible={confirmTarget !== null}
        title={
          confirmTarget?.kind === "clearAll"
            ? "清空全部本机记忆？"
            : confirmTarget?.kind === "clearProject"
              ? `清空「${confirmTarget.projectLabel}」记忆？`
              : confirmTarget?.kind === "deleteSelected"
                ? `删除选中的 ${confirmTarget.names.length} 个记忆文件？`
                : `删除记忆文件「${confirmTarget?.fileName ?? ""}」？`
        }
        message={
          confirmTarget?.kind === "clearAll"
            ? "这会删除本机所有项目的全部记忆文件，不删除会话本身。已经打开的会话仍持有内存里的记忆，重新打开后完全清除。"
            : confirmTarget?.kind === "clearProject"
              ? `将删除「${confirmTarget.projectLabel}」下的全部 ${confirmTarget.count} 个记忆文件，此操作不可恢复。`
              : confirmTarget?.kind === "deleteSelected"
                ? `将彻底删除选中的 ${confirmTarget.names.length} 个记忆文件（并同步清理 MEMORY.md 索引），不可恢复。`
                : `将彻底删除「${confirmTarget?.fileName ?? ""}」（并同步清理 MEMORY.md 索引），不可恢复。`
        }
        confirmLabel={
          confirmTarget?.kind === "clearAll" || confirmTarget?.kind === "clearProject"
            ? "确认清空"
            : "确认删除"
        }
        danger
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          if (confirmTarget) void executeConfirmAction(confirmTarget);
        }}
      />
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
  usageTotalCol: { flex: 1, gap: 2 },
  total: { ...text("title"), fontWeight: "700" },
  usageSub: { ...text("micro") },
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
  // 记忆文件浏览器与精细管理
  fileChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space(1.5),
    paddingHorizontal: space(3.5),
    paddingTop: space(2.5),
  },
  fileChip: {
    maxWidth: 180,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  fileChipText: { ...text("micro"), fontWeight: "600" },
  toolbarWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    marginHorizontal: space(3.5),
    marginTop: space(2),
    marginBottom: space(1),
  },
  fileSearch: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileSearchInput: { flex: 1, ...text("small"), padding: 0 },
  manageToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  manageToggleText: { ...text("micro"), fontWeight: "700" },
  batchBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
    marginHorizontal: space(3.5),
    marginBottom: space(1),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  selectAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
  },
  selectAllText: { ...text("micro"), fontWeight: "600" },
  batchActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
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
    gap: space(2),
    paddingHorizontal: space(3.5),
    paddingVertical: space(1.5),
  },
  fileRowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    minWidth: 0,
    paddingVertical: space(0.5),
  },
  fileRowText: { flex: 1, minWidth: 0, gap: 2 },
  fileRowName: { ...text("small"), fontWeight: "600" },
  fileRowMeta: { ...text("micro") },
  rowDeleteBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
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
  viewerActionRow: { flexDirection: "row", alignItems: "center", gap: space(2.5) },
  fileViewerToggle: { ...text("micro"), fontWeight: "700" },
  fileViewerBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
  },
  fileViewerRaw: { ...text("small"), fontFamily: "monospace", lineHeight: 18 },
  fileViewerInput: {
    ...text("small"),
    fontFamily: "monospace",
    lineHeight: 18,
    minHeight: 180,
    textAlignVertical: "top",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2.5),
  },
  message: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
  },
  messageText: { ...text("small") },
});
