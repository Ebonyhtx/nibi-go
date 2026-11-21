// 工作区右侧面板：手机主界面从右往左滑呼出（index.tsx 接线）。
//   1. 文件：workspacePath 目录树（懒展开，目录在前、按名排序，相对路径显示）+
//      文件名搜索（下钻整棵工作区，跳过 node_modules/.git 等重目录，限量防爆走）。
//   2. 查看器：点文件后在面板内推入查看层（覆盖文件树）——md 走 MessageMarkdown、
//      html/svg 走 WebView、图片自适应宽、其余等宽文本；>512KB 拒开，文本 >100KB 截断。
//   3. 子智能体：本会话派出的 AgentFace 瓦片脸 + 状态词 + 两行摘要。
// 动效与结构对齐 GoDrawer（slide/dim 两段 timing + 轻视差），只是方向从右、宽一档。
import { Fragment, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  Alert,
  Animated,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  EncodingType,
  getInfoAsync,
  readAsStringAsync,
  readDirectoryAsync,
} from "expo-file-system/legacy";
import { WebView } from "react-native-webview";

import { AgentFace } from "./AgentFace";
import { Icon } from "./Icon";
import { MessageMarkdown } from "./MessageMarkdown";
import { fileUriOf } from "../kernel/workspace";
import { PressableScale } from "../motion/PressableScale";
import { easingStandard } from "../motion/easing";
import { motion, radius, size, space, text, useNibiTheme } from "../theme";

/** 子智能体行（状态集与 AgentFaceStatus 同形；主线从会话行派生后传入）。 */
export interface WorkspaceSubagent {
  key: string;
  name: string;
  status: "running" | "completed" | "failed" | "cancelled" | "waiting";
  summary?: string;
}

/** 树节点：absPath 供继续读目录/读文件，relPath 是展示与展开态的键。 */
interface FileNode {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  size?: number;
}

/** 查看层状态：content 只在非图片类型下读；aspect 是图片宽高比（onLoad 前 null）。 */
interface ViewerState {
  node: FileNode;
  content: string | null;
  truncated: boolean;
  error: string | null;
  aspect: number | null;
}

type ViewerKind = "md" | "html" | "svg" | "image" | "text";

const MAX_VIEWER_BYTES = 512 * 1024; // 超过的文件拒绝进查看层（手机上读不动也没法读）
const MAX_TEXT_CHARS = 100 * 1024; // 等宽文本层最多渲染的字符数（超出截断）
const SEARCH_MAX = 200; // 搜索最多收集的命中数（防全仓爆走）
const SEARCH_DEPTH = 10; // 搜索下钻深度上限

/** 搜索下钻跳过的重目录（懒树里可以手动展开，搜索不值得走）。 */
const SEARCH_SKIP = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".expo",
  ".gradle",
  ".idea",
  ".vscode",
  "build",
  "dist",
]);

const KIND_LABEL: Record<ViewerKind, string> = {
  md: "Markdown",
  html: "HTML",
  svg: "SVG",
  image: "图片",
  text: "文本",
};

const STATUS_TEXT: Record<WorkspaceSubagent["status"], string> = {
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
  waiting: "等待中",
};

function kindOf(name: string): ViewerKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".svg")) return "svg";
  if (/\.(?:png|jpe?g|webp|gif)$/u.test(lower)) return "image";
  return "text";
}

/** svg 包一层离线可渲染的页面壳（viewport + 白底 + svg 自适应宽）。 */
function svgHtml(svg: string): string {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<style>body{margin:12px;background:#fff}svg{max-width:100%;height:auto}</style></head><body>" +
    svg +
    "</body></html>"
  );
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/u, "")}/${name}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 名字归一（有的平台 readDirectoryAsync 回传全路径）：统一取末段。 */
function normalizeEntry(entry: string): string {
  return entry.split(/[\\/]/u).pop() ?? entry;
}

/** 读一层目录：名字归一 → 逐项探测类型/大小 → 目录在前、按名排序。 */
async function listChildren(dirUri: string, dirRel: string): Promise<FileNode[]> {
  const entries = await readDirectoryAsync(dirUri);
  const names = Array.from(
    new Set(entries.map(normalizeEntry).filter((name) => name.length > 0)),
  );
  const nodes = await Promise.all(
    names.map(async (name): Promise<FileNode> => {
      const absPath = joinPath(dirUri, name);
      const relPath = dirRel ? `${dirRel}/${name}` : name;
      let isDir = false;
      let size: number | undefined;
      try {
        const info = await getInfoAsync(absPath);
        isDir = info.isDirectory;
        if (info.exists && !info.isDirectory && typeof info.size === "number") size = info.size;
      } catch {
        // 类型探测失败按文件处理：点开时再报错。
      }
      return { name, relPath, absPath, isDir, size };
    }),
  );
  return nodes.sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
  );
}

/**
 * 工作区面板：右侧滑入的抽屉。面板常驻挂载（关闭只滑走，与 GoDrawer 同策略），
 * 内容分三块：文件树 / 查看层（覆盖文件树）/ 子智能体列表。
 */
export function WorkspacePanel({
  visible,
  onClose,
  workspacePath,
  subagents,
}: {
  visible: boolean;
  onClose: () => void;
  /** 当前项目的绝对目录；null 时整块内容显示空态。 */
  workspacePath: string | null;
  subagents: readonly WorkspaceSubagent[];
}) {
  const t = useNibiTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelWidth = Math.min(360, Math.round(width * 0.88));

  const slide = useRef(new Animated.Value(0)).current;
  const dim = useRef(new Animated.Value(0)).current;
  // 内容轻视差：展开时从 +8px 滑到位（右侧抽屉，方向与 GoDrawer 相反）。
  const content = useRef(new Animated.Value(1)).current;
  // 搜索框 ref：收起时 blur 用（见上面的动效 effect）。
  const searchRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  useEffect(() => {
    // 面板是「大件」，走 slow 320 + standard 曲线（动效契约）；遮罩快一档跟手。
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: motion.duration.slow,
      easing: easingStandard,
      useNativeDriver: true,
    }).start();
    Animated.timing(dim, {
      toValue: visible ? 1 : 0,
      duration: motion.duration.base,
      easing: easingStandard,
      useNativeDriver: true,
    }).start();
    if (visible) {
      content.setValue(0);
      Animated.timing(content, {
        toValue: 1,
        delay: 40,
        duration: motion.duration.base,
        easing: easingStandard,
        useNativeDriver: true,
      }).start();
    } else {
      // 收起时搜索框可能还是 IME 的 served view：不收键盘会一直压在主界面上。
      searchRef.current?.blur();
      Keyboard.dismiss();
    }
  }, [visible, slide, dim, content]);

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [panelWidth, 0] });
  const contentX = content.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  // ── 文件树状态 ──────────────────────────────────────────────────────────
  const [rootNodes, setRootNodes] = useState<FileNode[] | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  // 已加载的子目录缓存（键 = 相对路径，"" = 根）；懒展开只在点开时读一层。
  const [childrenMap, setChildrenMap] = useState<Record<string, FileNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [reloadTick, setReloadTick] = useState(0);

  // ── 搜索状态 ───────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<FileNode[] | null>(null);
  const [searching, setSearching] = useState(false);

  // ── 查看层状态 ──────────────────────────────────────────────────────────
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const viewerNode = viewer?.node ?? null;

  // 换工作区：清缓存、收起、关查看层（面板关闭不清现场，重开还是原样）。
  useEffect(() => {
    setRootNodes(null);
    setRootError(null);
    setChildrenMap({});
    setExpanded(new Set());
    setViewer(null);
    setSearch("");
    setSearchResults(null);
    setSearching(false);
  }, [workspacePath]);

  // 面板展开（或刷新）时读 workspace 根；重新打开会重读一遍，保持文件列表新鲜。
  useEffect(() => {
    if (!visible || !workspacePath) return;
    let alive = true;
    setRootError(null);
    (async () => {
      try {
        const nodes = await listChildren(fileUriOf(workspacePath), "");
        if (!alive) return;
        setChildrenMap((prev) => ({ ...prev, "": nodes }));
        setRootNodes(nodes);
      } catch (error) {
        if (alive) setRootError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, workspacePath, reloadTick]);

  // 搜索：有词时下钻整棵工作区收集文件名命中（跳过重目录、限深限量）。
  useEffect(() => {
    const query = search.trim().toLowerCase();
    if (!visible || !workspacePath || query.length === 0) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    (async () => {
      const hits: FileNode[] = [];
      const walk = async (dirUri: string, dirRel: string, depth: number): Promise<void> => {
        if (hits.length >= SEARCH_MAX || depth > SEARCH_DEPTH) return;
        let entries: string[];
        try {
          entries = await readDirectoryAsync(dirUri);
        } catch {
          return; // 读不了的目录（权限/符号链接）直接跳过。
        }
        const names = Array.from(
          new Set(entries.map(normalizeEntry).filter((name) => name.length > 0)),
        );
        const subDirs: Array<{ uri: string; rel: string }> = [];
        await Promise.all(
          names.map(async (name) => {
            const absPath = joinPath(dirUri, name);
            const relPath = dirRel ? `${dirRel}/${name}` : name;
            let isDir = false;
            let size: number | undefined;
            try {
              const info = await getInfoAsync(absPath);
              isDir = info.isDirectory;
              if (info.exists && !info.isDirectory && typeof info.size === "number") {
                size = info.size;
              }
            } catch {
              // 探测失败仍按名字匹配。
            }
            if (isDir) {
              if (!SEARCH_SKIP.has(name)) subDirs.push({ uri: absPath, rel: relPath });
            } else if (name.toLowerCase().includes(query)) {
              hits.push({ name, relPath, absPath, isDir: false, size });
            }
          }),
        );
        for (const dir of subDirs) {
          if (hits.length >= SEARCH_MAX) return;
          await walk(dir.uri, dir.rel, depth + 1);
        }
      };
      try {
        await walk(fileUriOf(workspacePath), "", 0);
      } catch {
        // 走不完就走到哪算哪。
      }
      if (!alive) return;
      setSearchResults(hits.slice(0, SEARCH_MAX));
      setSearching(false);
    })();
    return () => {
      alive = false;
    };
  }, [search, workspacePath, visible]);

  // 查看层内容：非图片类型读全文（UTF8）；文本超 100KB 截断标记。
  useEffect(() => {
    if (!viewerNode || kindOf(viewerNode.name) === "image") return;
    let alive = true;
    (async () => {
      try {
        const raw = await readAsStringAsync(viewerNode.absPath, { encoding: EncodingType.UTF8 });
        if (!alive) return;
        const truncated = raw.length > MAX_TEXT_CHARS;
        setViewer((prev) =>
          prev && prev.node.relPath === viewerNode.relPath
            ? { ...prev, content: truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw, truncated }
            : prev,
        );
      } catch (error) {
        if (!alive) return;
        setViewer((prev) =>
          prev && prev.node.relPath === viewerNode.relPath
            ? { ...prev, error: error instanceof Error ? error.message : String(error) }
            : prev,
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewerNode]);

  // 图片：预取宽高算 aspectRatio（自适应宽高，不撑变形）。
  useEffect(() => {
    if (!viewerNode || kindOf(viewerNode.name) !== "image") return;
    let alive = true;
    Image.getSize(
      fileUriOf(viewerNode.absPath),
      (w, h) => {
        if (!alive || w <= 0 || h <= 0) return;
        setViewer((prev) =>
          prev && prev.node.relPath === viewerNode.relPath ? { ...prev, aspect: w / h } : prev,
        );
      },
      () => {
        // 取不到尺寸就用兜底比例，Image 自己会按 contain 缩。
      },
    );
    return () => {
      alive = false;
    };
  }, [viewerNode]);

  const loadChildrenOf = async (node: FileNode) => {
    setLoadingDirs((prev) => new Set(prev).add(node.relPath));
    try {
      const nodes = await listChildren(node.absPath, node.relPath);
      setChildrenMap((prev) => ({ ...prev, [node.relPath]: nodes }));
    } catch (error) {
      Alert.alert(
        "读取目录失败",
        `${node.name}：${error instanceof Error ? error.message : String(error)}`,
      );
      // 读不了的目录收回起态，避免停在「读取中」。
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(node.relPath);
        return next;
      });
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(node.relPath);
        return next;
      });
    }
  };

  const toggleDir = (node: FileNode) => {
    const willExpand = !expanded.has(node.relPath);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(node.relPath);
      else next.delete(node.relPath);
      return next;
    });
    if (willExpand && childrenMap[node.relPath] === undefined) void loadChildrenOf(node);
  };

  /** 刷新：清掉已加载的子目录缓存、全部收起，重读根（reloadTick 触发根 effect）。 */
  const refreshTree = () => {
    setChildrenMap({});
    setExpanded(new Set());
    setReloadTick((n) => n + 1);
  };

  const openFile = (node: FileNode) => {
    if (typeof node.size === "number" && node.size > MAX_VIEWER_BYTES) {
      Alert.alert(
        "文件过大",
        `${node.name} 有 ${formatSize(node.size)}，超过 512KB 打不开；回桌面看完整内容。`,
      );
      return;
    }
    setViewer({ node, content: null, truncated: false, error: null, aspect: null });
  };

  // 子智能体状态词的语义色（running/waiting 同色：都是「还在路上」）。
  const statusColor = (status: WorkspaceSubagent["status"]): string => {
    if (status === "failed") return t.red;
    if (status === "completed") return t.ok;
    if (status === "cancelled") return t.inkFaint;
    return t.amber;
  };

  /** 目录树行（递归渲染已展开的子级；懒展开的子级在读到前显示一行提示）。 */
  const renderTreeRows = (nodes: FileNode[], depth: number): ReactNode[] =>
    nodes.map((node) => {
      const isOpen = expanded.has(node.relPath);
      const kids = node.isDir ? childrenMap[node.relPath] : undefined;
      return (
        <Fragment key={node.relPath}>
          <PressableScale
            scaleTo={0.97}
            onPress={() => (node.isDir ? toggleDir(node) : openFile(node))}
            accessibilityRole="button"
            accessibilityLabel={
              node.isDir ? `${isOpen ? "收起" : "展开"}目录 ${node.name}` : `打开文件 ${node.name}`
            }
            style={[styles.row, { paddingLeft: space(1.5) + depth * space(3) }]}
          >
            {node.isDir ? (
              <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={12} color={t.inkGhost} />
            ) : (
              /* 文件行用占位空档对齐目录行的箭头位。 */
              <View style={styles.rowStub} />
            )}
            <Icon name={node.isDir ? "folder" : "doc"} size={14} color={node.isDir ? t.inkSub : t.inkFaint} />
            <Text numberOfLines={1} style={[styles.rowText, { color: t.ink }]}>
              {node.name}
            </Text>
          </PressableScale>
          {node.isDir && isOpen ? (
            kids ? (
              kids.length > 0 ? (
                renderTreeRows(kids, depth + 1)
              ) : (
                <Text
                  style={[
                    styles.rowHint,
                    { color: t.inkFaint, paddingLeft: space(1.5) + (depth + 1) * space(3) },
                  ]}
                >
                  空目录
                </Text>
              )
            ) : loadingDirs.has(node.relPath) ? (
              <Text
                style={[
                  styles.rowHint,
                  { color: t.inkFaint, paddingLeft: space(1.5) + (depth + 1) * space(3) },
                ]}
              >
                读取中…
              </Text>
            ) : null
          ) : null}
        </Fragment>
      );
    });

  const query = search.trim();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
      <Animated.View style={[styles.dim, { opacity: dim, backgroundColor: t.backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭工作区" />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            width: panelWidth,
            backgroundColor: t.card,
            borderLeftColor: t.hairline,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            transform: [{ translateX }],
            // 弹层投影（elevation.menu）：压在正文上要有「浮起来」的一档。
            ...t.elevation.menu,
          },
        ]}
      >
        <Animated.View style={[styles.panelContent, { transform: [{ translateX: contentX }] }]}>
          {/* 顶部标题行 */}
          <View style={styles.head}>
            <Text style={[styles.headTitle, { color: t.ink }]}>工作区</Text>
            <PressableScale
              scaleTo={0.94}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="关闭工作区"
              hitSlop={6}
              style={[styles.headClose, { backgroundColor: t.surfaceSoft }]}
            >
              <Icon name="x" size={15} color={t.inkSub} />
            </PressableScale>
          </View>

          {workspacePath === null ? (
            /* 没有项目工作区：整块空态（文件树与查看层都不存在）。 */
            <Text style={[styles.emptyText, { color: t.inkFaint, paddingHorizontal: space(3.5) }]}>
              没有项目工作区
            </Text>
          ) : (
            <View style={styles.content}>
              <ScrollView
                style={styles.flex1}
                contentContainerStyle={styles.scroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* 1. 文件：刷新 + 搜索井 + 懒展开目录树 */}
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: t.inkFaint }]}>文件</Text>
                  <PressableScale
                    scaleTo={0.94}
                    onPress={refreshTree}
                    accessibilityRole="button"
                    accessibilityLabel="刷新文件列表"
                    hitSlop={6}
                    style={styles.sectionAction}
                  >
                    <Icon name="refresh" size={13} color={t.inkSub} />
                  </PressableScale>
                </View>
                <View
                  style={[
                    styles.search,
                    {
                      backgroundColor: t.surfaceSoft,
                      borderColor: searchFocused ? t.hairlineStrong : t.hairline,
                    },
                  ]}
                >
                  <Icon name="search" size={13} color={t.inkGhost} />
                  <TextInput
                    ref={searchRef}
                    value={search}
                    onChangeText={setSearch}
                    placeholder="搜索文件名"
                    placeholderTextColor={t.inkFaint}
                    style={[styles.searchInput, { color: t.ink }]}
                    autoCorrect={false}
                    autoCapitalize="none"
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                  />
                  {search.length > 0 ? (
                    <Pressable
                      onPress={() => setSearch("")}
                      accessibilityRole="button"
                      accessibilityLabel="清除搜索"
                      hitSlop={8}
                    >
                      <Icon name="x" size={13} color={t.inkGhost} />
                    </Pressable>
                  ) : null}
                </View>
                {rootError ? (
                  <Text style={[styles.emptyText, { color: t.red }]}>读不了工作区：{rootError}</Text>
                ) : query.length > 0 ? (
                  searching ? (
                    <Text style={[styles.emptyText, { color: t.inkFaint }]}>搜索中…</Text>
                  ) : searchResults && searchResults.length > 0 ? (
                    searchResults.map((node) => (
                      <PressableScale
                        key={node.relPath}
                        scaleTo={0.97}
                        onPress={() => openFile(node)}
                        accessibilityRole="button"
                        accessibilityLabel={`打开文件 ${node.name}`}
                        style={styles.row}
                      >
                        <Icon name="doc" size={14} color={t.inkFaint} />
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          style={[styles.rowText, { color: t.ink }]}
                        >
                          {node.relPath}
                        </Text>
                      </PressableScale>
                    ))
                  ) : (
                    <Text style={[styles.emptyText, { color: t.inkFaint }]}>没有匹配的文件</Text>
                  )
                ) : rootNodes === null ? (
                  <Text style={[styles.emptyText, { color: t.inkFaint }]}>读取中…</Text>
                ) : rootNodes.length === 0 ? (
                  <Text style={[styles.emptyText, { color: t.inkFaint }]}>工作区是空的</Text>
                ) : (
                  renderTreeRows(rootNodes, 0)
                )}

                {/* 3. 子智能体：瓦片脸 + 状态词 + 两行摘要 */}
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: t.inkFaint }]}>子智能体</Text>
                </View>
                {subagents.length === 0 ? (
                  <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                    本会话还没有派出子智能体
                  </Text>
                ) : (
                  subagents.map((agent) => (
                    <View key={agent.key} style={styles.agentRow}>
                      <AgentFace name={agent.name} status={agent.status} size={22} badge />
                      <View style={styles.agentCol}>
                        <View style={styles.agentTop}>
                          <Text numberOfLines={1} style={[styles.agentName, { color: t.ink }]}>
                            {agent.name}
                          </Text>
                          <Text style={[styles.agentStatus, { color: statusColor(agent.status) }]}>
                            {STATUS_TEXT[agent.status]}
                          </Text>
                        </View>
                        {agent.summary ? (
                          <Text
                            numberOfLines={2}
                            style={[styles.agentSummary, { color: t.inkFaint }]}
                          >
                            {agent.summary}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>

              {/* 2. 查看层：点文件后覆盖整个内容区（顶栏返回 + 文件名 + 按类型渲染）。 */}
              {viewer ? (
                <View style={[styles.viewerLayer, { backgroundColor: t.card }]}>
                  <View style={[styles.viewerHead, { borderBottomColor: t.hairline }]}>
                    <PressableScale
                      scaleTo={0.94}
                      onPress={() => setViewer(null)}
                      accessibilityRole="button"
                      accessibilityLabel="返回文件列表"
                      hitSlop={6}
                      style={styles.viewerBack}
                    >
                      <Icon name="chevron-left" size={15} color={t.inkSub} />
                    </PressableScale>
                    <Text numberOfLines={1} style={[styles.viewerTitle, { color: t.ink }]}>
                      {viewer.node.name}
                    </Text>
                    <Text style={[styles.viewerKind, { color: t.inkFaint }]}>
                      {KIND_LABEL[kindOf(viewer.node.name)]}
                    </Text>
                  </View>
                  <View style={styles.viewerBody}>
                    {viewer.error ? (
                      <Text style={[styles.viewerHint, { color: t.red }]}>
                        读不出来：{viewer.error}
                      </Text>
                    ) : kindOf(viewer.node.name) === "image" ? (
                      <View style={styles.imageWrap}>
                        <Image
                          source={{ uri: fileUriOf(viewer.node.absPath) }}
                          style={{
                            width: "100%",
                            aspectRatio: viewer.aspect ?? 4 / 3,
                          }}
                          resizeMode="contain"
                        />
                      </View>
                    ) : viewer.content === null ? (
                      <Text style={[styles.viewerHint, { color: t.inkFaint }]}>读取中…</Text>
                    ) : kindOf(viewer.node.name) === "md" ? (
                      <ScrollView
                        contentContainerStyle={styles.mdWrap}
                        showsVerticalScrollIndicator={false}
                      >
                        <MessageMarkdown text={viewer.content} />
                      </ScrollView>
                    ) : kindOf(viewer.node.name) === "html" ? (
                      <WebView source={{ html: viewer.content }} style={styles.viewerWeb} />
                    ) : kindOf(viewer.node.name) === "svg" ? (
                      <WebView source={{ html: svgHtml(viewer.content) }} style={styles.viewerWeb} />
                    ) : (
                      <ScrollView
                        contentContainerStyle={styles.mdWrap}
                        showsVerticalScrollIndicator={false}
                      >
                        <Text selectable style={[styles.textBody, { color: t.ink }]}>
                          {viewer.content}
                          {viewer.truncated
                            ? "\n\n——已截断：文件超过 100KB，只显示前 100KB。"
                            : ""}
                        </Text>
                      </ScrollView>
                    )}
                  </View>
                </View>
              ) : null}
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  dim: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 19,
  },
  // 右缘贴边的抽屉：左边一条发丝线（与 GoDrawer 的右缘线镜像）。
  panel: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    zIndex: 20,
  },
  panelContent: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(3.5),
    paddingTop: space(3),
    paddingBottom: space(2),
  },
  headTitle: { flex: 1, ...text("bodyLg"), fontWeight: "700" },
  headClose: {
    width: size.chipLg,
    height: size.chipLg,
    borderRadius: radius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1 },
  scroll: { paddingHorizontal: space(3.5), paddingBottom: space(4) },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    paddingTop: space(2),
    paddingBottom: space(1.5),
  },
  sectionTitle: {
    flex: 1,
    ...text("micro"),
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  sectionAction: {
    width: size.chip,
    height: size.chip,
    borderRadius: radius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  // 搜索井：surfaceSoft 内嵌面，聚焦只把发丝线加深一档（同 GoDrawer）。
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    marginBottom: space(1.5),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, ...text("small"), padding: 0 },
  // 紧凑行：32px 档（size.chipLg），压住树的高度。
  row: {
    minHeight: size.chipLg,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    paddingVertical: space(1),
    paddingRight: space(1.5),
    borderRadius: radius.xs,
  },
  rowStub: { width: 12 },
  rowText: { flex: 1, ...text("small") },
  rowHint: { ...text("micro"), paddingTop: space(0.5) },
  emptyText: { ...text("small"), paddingVertical: space(1.5) },
  // 查看层：覆盖内容区（面板标题行保留），顶栏下一条发丝线。
  viewerLayer: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  },
  viewerHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(3.5),
    paddingTop: space(2),
    paddingBottom: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  viewerBack: {
    width: size.chip,
    height: size.chip,
    borderRadius: radius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerTitle: { flex: 1, ...text("small"), fontWeight: "700" },
  viewerKind: { ...text("micro") },
  viewerBody: { flex: 1 },
  viewerWeb: { flex: 1, backgroundColor: "#ffffff" },
  viewerHint: { ...text("small"), padding: space(3.5) },
  mdWrap: { padding: space(3.5), paddingBottom: space(6) },
  textBody: { ...text("small"), fontFamily: "monospace" },
  imageWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space(2),
  },
  // 子智能体行：脸 22 + 名字/状态词一行 + 摘要两行。
  agentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2),
    paddingVertical: space(1.5),
  },
  agentCol: { flex: 1, minWidth: 0 },
  agentTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    minHeight: size.chipLg - space(3),
  },
  agentName: { flex: 1, ...text("small"), fontWeight: "600" },
  agentStatus: { ...text("micro"), fontWeight: "600" },
  agentSummary: { ...text("micro"), marginTop: 2 },
});
