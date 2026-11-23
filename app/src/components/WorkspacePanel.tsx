// 工作区右侧面板：手机主界面横向滑呼出（index.tsx 接线，中部滑动即可，跟手）。
// 结构对齐 NIBI 客户端右侧面板（运营者 2026-11-22 定）：**先看到胶囊入口卡片**——
//   1. 文件 → 工作区文件树（懒展开/搜索）→ 点文件进查看器（md/html/svg/图片/文本）；
//   2. 子智能体 → 本会话的瓦片脸列表 → 点有子会话的项**在面板内直接看消息流**
//      （只读订阅子会话 topic，不占主会话订阅槽；运营者明确要求在面板里看）。
// 动效与结构对齐 GoDrawer（slide/dim 两段 timing + 轻视差），方向从右、宽一档；
// 暴露 WorkspacePanelHandle 供主界面中部横向手势跟手拖动。
import { Fragment, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeInRight,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { haptic } from "../motion/haptics";
import { resolveAdaptiveLayout, SUPPORTED_MODAL_ORIENTATIONS } from "../layout/adaptive";
import { rubberBandProgress, SIDE_BLEED, SIDE_SPRING_CONFIG } from "../motion/sidePhysics";
import {
  Alert,
  Image,
  Modal,
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
import { pickText, useI18n } from "../i18n";
import { Icon } from "./Icon";
import { MessageMarkdown } from "./MessageMarkdown";
import { ConversationFeed, deriveRows, type ChatRow } from "@nibi-go/kernel-session";
import { currentKernelClient } from "../kernel/kernelRegistry";
import { fileUriOf } from "../kernel/workspace";
import { PressableScale } from "../motion/PressableScale";
import { easingStandard } from "../motion/easing";
import { radius, size, space, text, useNibiScheme, useNibiTheme } from "../theme";
import {
  isLikelyBinaryText,
  OFFICE_KIND_LABEL,
  officeKindOf,
  renderOfficeBase64ToHtml,
  type OfficeDocKind,
} from "../workspace/officePreview";

/** 子智能体行（状态集与 AgentFaceStatus 同形；主线从会话行派生后传入）。 */
export interface WorkspaceSubagent {
  key: string;
  name: string;
  status: "running" | "completed" | "failed" | "cancelled" | "waiting";
  summary?: string;
  /** 子会话 id：有它才能下钻看子智能体的消息流。 */
  childSessionId?: string;
}

/** 树节点：absPath 供继续读目录/读文件，relPath 是展示与展开态的键。 */
interface FileNode {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  size?: number;
}

/** 查看层状态：content 存文本或 Office/PDF 渲染后的 HTML；aspect 是图片宽高比（onLoad 前 null）。 */
interface ViewerState {
  node: FileNode;
  content: string | null;
  truncated: boolean;
  binaryNotice: boolean;
  error: string | null;
  aspect: number | null;
}

type ViewerKind = "md" | "html" | "svg" | "image" | OfficeDocKind | "text";

const MAX_TEXT_VIEWER_BYTES = 512 * 1024; // 纯文本文件上限（超过在手机上读不动）
const MAX_RICH_VIEWER_BYTES = 10 * 1024 * 1024; // Office / PDF / 图片上限 10MB
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

function kindLabel(kind: ViewerKind): string {
  const labels: Record<ViewerKind, string> = {
    md: "Markdown",
    html: "HTML",
    svg: "SVG",
    image: pickText("图片", "Image"),
    ...OFFICE_KIND_LABEL,
    text: pickText("文本", "Text"),
  };
  return labels[kind];
}

function statusText(status: WorkspaceSubagent["status"]): string {
  switch (status) {
    case "running":
      return pickText("进行中", "Running");
    case "completed":
      return pickText("已完成", "Done");
    case "failed":
      return pickText("失败", "Failed");
    case "cancelled":
      return pickText("已停止", "Stopped");
    case "waiting":
      return pickText("等待中", "Waiting");
  }
}

function kindOf(name: string): ViewerKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".svg")) return "svg";
  if (/\.(?:png|jpe?g|webp|gif)$/u.test(lower)) return "image";
  const office = officeKindOf(name);
  if (office) return office;
  return "text";
}

function isOfficeKind(kind: ViewerKind): kind is OfficeDocKind {
  return kind === "docx" || kind === "xlsx" || kind === "pptx" || kind === "pdf";
}

function isWebViewerKind(kind: ViewerKind): boolean {
  return kind === "html" || kind === "svg" || isOfficeKind(kind);
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
/** 外部手势拖动 API（主界面中部横向滑：跟手拖动面板）。 */
export interface WorkspacePanelHandle {
  beginDrag: () => void;
  moveDrag: (dx: number) => void;
  /** 松手：过阈值停靠打开（父级 setVisible），否则弹回。 */
  endDrag: (velocityX: number) => void;
}

/** 面板一级入口：胶囊卡片（对齐 NIBI 客户端右侧面板的语义——先选入口，再下钻）。 */
type WorkspaceMode = "hub" | "files" | "agents";

/** 右侧工作区面板（进度由父级共享值驱动：-1 完全展开、0 收起）。 */
export function WorkspacePanel({
  visible,
  onClose,
  onSwipeClose,
  progress,
  dragging,
  workspacePath,
  subagents,
}: {
  visible: boolean;
  onClose: () => void;
  /** 右滑松手已起速度弹簧时回调，只同步 JS 开关态，避免二次动画卡顿。 */
  onSwipeClose?: () => void;
  /** 侧栏进度（index 的共享值：+1 左抽屉 / -1 右面板 / 0 收起）。 */
  progress: SharedValue<number>;
  /** 手指拖动标记（1=拖动，0=松手）：拖动期不挂载真模糊。 */
  dragging: SharedValue<number>;
  /** 当前项目的绝对目录；null 时整块内容显示空态。 */
  workspacePath: string | null;
  subagents: readonly WorkspaceSubagent[];
}) {
  const t = useNibiTheme();
  const { locale, pick } = useI18n();
  const scheme = useNibiScheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelWidth = resolveAdaptiveLayout({ width, height }).workspacePanelWidth;
  // 横屏时右缘可能有安全区（insets.right）：收起位移覆盖完整宽并在完全收起时隐藏边线/阴影。
  const totalWidth = panelWidth + insets.right;
  const panelWidthSV = useSharedValue(totalWidth);
  useEffect(() => {
    panelWidthSV.value = totalWidth;
  }, [totalWidth, panelWidthSV]);
  // 一级入口；打开面板回到 hub（每次进来先选入口）。
  const [mode, setMode] = useState<WorkspaceMode>("hub");
  // 面板内正在查看的子智能体（有子会话的行点进来直接看消息流）。
  const [transcriptAgent, setTranscriptAgent] = useState<WorkspaceSubagent | null>(null);
  const searchRef = useRef<ComponentRef<typeof TextInput> | null>(null);

  // 负进度 → 位移动画（面板在右，展开时 translateX=0；右缘留 SIDE_BLEED 防超拉露缝）。
  const panelStyle = useAnimatedStyle(() => {
    const p = Math.max(0, -progress.value);
    return {
      opacity: p <= 0.001 ? 0 : 1,
      transform: [{ translateX: panelWidthSV.value * (1 - p) }],
    };
  });
  const contentStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, -progress.value));
    return { transform: [{ translateX: 10 * (1 - p) }] };
  });
  // 展开后在面板上往右拖 = 跟手关闭；保留松手初速、过阈轻触感、异常取消自动复位。
  // 必须在 onStart（跨过 activeOffsetX 真正成拖动）才置 dragging=1，否则面板内点按钮
  // 会触发 onBegin → 抹掉玻璃模糊并在 onFinalize 里把 progress 重置回 -1。
  const crossed = useSharedValue(0);
  const panActive = useSharedValue(0);
  const closeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(visible)
        .activeOffsetX([-20, 20])
        .failOffsetY([-16, 16])
        .onBegin(() => {
          "worklet";
          panActive.value = 0;
          crossed.value = 0;
        })
        .onStart(() => {
          "worklet";
          panActive.value = 1;
          dragging.value = 1;
          crossed.value = 0;
        })
        .onUpdate((event) => {
          "worklet";
          const raw = -1 + event.translationX / panelWidthSV.value;
          progress.value = raw < -1 ? -1 - rubberBandProgress(-1 - raw) : Math.min(0, raw);
          if (progress.value > -0.65 && crossed.value === 0) {
            crossed.value = 1;
            runOnJS(haptic)("threshold");
          } else if (progress.value < -0.75 && crossed.value === 1) {
            crossed.value = 0;
          }
        })
        .onEnd((event) => {
          "worklet";
          const p = progress.value;
          const v = event.velocityX / panelWidthSV.value;
          if (p > -0.65 || event.velocityX > 550) {
            progress.value = withSpring(0, { ...SIDE_SPRING_CONFIG, velocity: v });
            runOnJS(onSwipeClose ?? onClose)();
          } else {
            progress.value = withSpring(-1, { ...SIDE_SPRING_CONFIG, velocity: v });
          }
        })
        .onFinalize((_event, success) => {
          "worklet";
          if (panActive.value === 1) {
            panActive.value = 0;
            dragging.value = 0;
            if (!success) {
              progress.value = withSpring(-1, SIDE_SPRING_CONFIG);
            }
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  );

  // 收起动画期间**不换内容**：打开时才复位会在面板滑入的第一帧先画旧内容再切 hub
  // （运营者看到的「内容闪一下」）。复位放到滑出完成之后（450ms > 300ms 动画），
  // 重开则取消计时器，整个滑动过程内容一动不动。
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
    if (!visible) {
      // 只 blur 面板自己的搜索框（有焦点才会收起 IME）；不再补 Keyboard.dismiss：
      // 百度输入法对已收起时的再次 dismiss 会反转成弹出。
      searchRef.current?.blur();
      resetTimer.current = setTimeout(() => {
        resetTimer.current = null;
        setMode("hub");
        setTranscriptAgent(null);
        setViewer(null);
        setViewerFullscreen(false);
        setSearch("");
        setSearchFocused(false);
        setSearchResults(null);
        setSearching(false);
      }, 450);
    }
  }, [visible]);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

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
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const viewerNode = viewer?.node ?? null;

  // 换工作区：清缓存、收起、关查看层（面板关闭不清现场，重开还是原样）。
  useEffect(() => {
    setRootNodes(null);
    setRootError(null);
    setChildrenMap({});
    setExpanded(new Set());
    setViewer(null);
    setViewerFullscreen(false);
    setSearch("");
    setSearchResults(null);
    setSearching(false);
  }, [workspacePath]);

  // 面板展开（或刷新）时读 workspace 根；重新打开会重读一遍，保持文件列表新鲜。
  // 首次展开的那次读取延到滑入动画之后：目录内容若在滑动途中被替换，看上去也是
  // 「内容闪一下」。刷新按钮（reloadTick）在面板里手点，不必等。
  const wasVisible = useRef(false);
  useEffect(() => {
    const justOpened = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!visible || !workspacePath) return;
    let alive = true;
    const run = () => {
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
    };
    const timer = justOpened ? setTimeout(run, 320) : null;
    if (!justOpened) run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
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

  // 查看层内容：
  // - Office/PDF（.docx/.xlsx/.pptx/.pdf）按 Base64 读原始字节，内存中解析渲染为排版 HTML；
  // - 文本/Markdown/HTML/SVG 按 UTF-8 读全文；未知二进制内容自动拦截，不打印乱码。
  useEffect(() => {
    if (!viewerNode) return;
    const kind = kindOf(viewerNode.name);
    if (kind === "image") return;
    let alive = true;
    (async () => {
      try {
        if (isOfficeKind(kind)) {
          const base64 = await readAsStringAsync(viewerNode.absPath, {
            encoding: EncodingType.Base64,
          });
          if (!alive) return;
          const html = renderOfficeBase64ToHtml(
            kind,
            viewerNode.name,
            base64,
            scheme === "dark",
          );
          setViewer((prev) =>
            prev && prev.node.relPath === viewerNode.relPath
              ? { ...prev, content: html, truncated: false, binaryNotice: false }
              : prev,
          );
          return;
        }
        const raw = await readAsStringAsync(viewerNode.absPath, { encoding: EncodingType.UTF8 });
        if (!alive) return;
        if (kind === "text" && isLikelyBinaryText(raw)) {
          setViewer((prev) =>
            prev && prev.node.relPath === viewerNode.relPath
              ? { ...prev, content: "", truncated: false, binaryNotice: true }
              : prev,
          );
          return;
        }
        const truncated = raw.length > MAX_TEXT_CHARS;
        setViewer((prev) =>
          prev && prev.node.relPath === viewerNode.relPath
            ? {
                ...prev,
                content: truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw,
                truncated,
                binaryNotice: false,
              }
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
  }, [viewerNode, scheme, locale]);

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
        pick("读取目录失败", "Couldn't read folder"),
        `${node.name}: ${error instanceof Error ? error.message : String(error)}`,
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
    const kind = kindOf(node.name);
    const limit =
      kind === "image" || isOfficeKind(kind) ? MAX_RICH_VIEWER_BYTES : MAX_TEXT_VIEWER_BYTES;
    if (typeof node.size === "number" && node.size > limit) {
      Alert.alert(
        pick("文件过大", "File too large"),
        pick(
          `${node.name} 有 ${formatSize(node.size)}，超过 ${formatSize(limit)} 预览上限；可在桌面查看完整内容。`,
          `${node.name} is ${formatSize(node.size)}, over the ${formatSize(limit)} preview limit. Open it on desktop to view everything.`,
        ),
      );
      return;
    }
    setViewerFullscreen(false);
    setViewer({
      node,
      content: null,
      truncated: false,
      binaryNotice: false,
      error: null,
      aspect: null,
    });
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
            scaleTo={0.98}
            onPress={() => (node.isDir ? toggleDir(node) : openFile(node))}
            accessibilityRole="button"
            accessibilityLabel={
              node.isDir
                ? pick(
                    `${isOpen ? "收起" : "展开"}目录 ${node.name}`,
                    `${isOpen ? "Collapse" : "Expand"} folder ${node.name}`,
                  )
                : pick(`打开文件 ${node.name}`, `Open file ${node.name}`)
            }
            style={({ pressed }) => [
              styles.row,
              {
                paddingLeft: space(2) + depth * space(3),
                backgroundColor: pressed ? t.hover : "transparent",
              },
            ]}
          >
            {node.isDir ? (
              <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={12} color={t.inkFaint} />
            ) : (
              /* 文件行用占位空档对齐目录行的箭头位。 */
              <View style={styles.rowStub} />
            )}
            <Icon
              name={node.isDir ? "folder" : "doc"}
              size={15}
              color={node.isDir ? t.brand : t.inkSub}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.rowText,
                { color: t.ink, fontWeight: node.isDir ? "600" : "400" },
              ]}
            >
              {node.name}
            </Text>
            {!node.isDir && typeof node.size === "number" ? (
              <Text style={[styles.rowMeta, { color: t.inkGhost }]}>{formatSize(node.size)}</Text>
            ) : null}
          </PressableScale>
          {node.isDir && isOpen ? (
            kids ? (
              kids.length > 0 ? (
                renderTreeRows(kids, depth + 1)
              ) : (
                <Text
                  style={[
                    styles.rowHint,
                    { color: t.inkFaint, paddingLeft: space(2) + (depth + 1) * space(3) },
                  ]}
                >
                  {pick("空目录", "Empty folder")}
                </Text>
              )
            ) : loadingDirs.has(node.relPath) ? (
              <Text
                style={[
                  styles.rowHint,
                  { color: t.inkFaint, paddingLeft: space(2) + (depth + 1) * space(3) },
                ]}
              >
                {pick("读取中…", "Loading…")}
              </Text>
            ) : null
          ) : null}
        </Fragment>
      );
    });

  const query = search.trim();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* 玻璃模糊/压暗由 index 的 SideBackdrop 统一渲染（左右两栏共用一层）。 */}
      <GestureDetector gesture={closeGesture}>
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[
          styles.panel,
          {
            right: -SIDE_BLEED,
            width: panelWidth + insets.right + SIDE_BLEED,
            paddingRight: SIDE_BLEED + insets.right,
            backgroundColor: t.card,
            borderLeftColor: t.hairline,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            // 弹层投影（elevation.menu）：压在正文上要有「浮起来」的一档。
            ...t.elevation.menu,
          },
          panelStyle,
        ]}
      >
        <Animated.View style={[styles.panelContent, contentStyle]}>
          {/* 顶部标题行：hub 显示「工作区」，下钻后带返回 + 段名。 */}
          <View style={styles.head}>
            {mode === "hub" ? null : (
              <PressableScale
                scaleTo={0.94}
                onPress={() => {
                  if (transcriptAgent) {
                    setTranscriptAgent(null);
                    return;
                  }
                  setMode("hub");
                  setViewer(null);
                  setViewerFullscreen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  transcriptAgent
                    ? pick("返回子智能体列表", "Back to subagents")
                    : pick("返回入口", "Back")
                }
                hitSlop={6}
                style={[
                  styles.headBack,
                  { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
                ]}
              >
                <Icon name="chevron-left" size={16} color={t.ink} />
              </PressableScale>
            )}
            <Text style={[styles.headTitle, { color: t.ink }]} numberOfLines={1}>
              {transcriptAgent
                ? transcriptAgent.name
                : mode === "files"
                  ? pick("文件", "Files")
                  : mode === "agents"
                    ? pick("子智能体", "Subagents")
                    : pick("工作区", "Workspace")}
            </Text>
            <PressableScale
              scaleTo={0.94}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={pick("关闭工作区", "Close workspace")}
              hitSlop={6}
              style={[
                styles.headClose,
                { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
              ]}
            >
              <Icon name="x" size={15} color={t.inkSub} />
            </PressableScale>
          </View>

          {mode === "hub" ? (
            /* 一级入口：胶囊卡片（对齐 NIBI 客户端右侧面板的语义——先选入口再下钻）。 */
            <View style={styles.hub}>
              <PressableScale
                scaleTo={0.97}
                onPress={() => setMode("files")}
                accessibilityRole="button"
                accessibilityLabel={pick("打开文件", "Open files")}
                style={[
                  styles.capsule,
                  {
                    backgroundColor: t.card,
                    borderColor: t.hairlineStrong,
                    ...t.elevation.card,
                  },
                ]}
              >
                <View style={[styles.capsuleIcon, { backgroundColor: t.brandSoft }]}>
                  <Icon name="folder" size={19} color={t.brand} />
                </View>
                <View style={styles.capsuleCol}>
                  <Text style={[styles.capsuleTitle, { color: t.ink }]}>{pick("文件", "Files")}</Text>
                  <Text style={[styles.capsuleDetail, { color: t.inkSub }]}>
                    {pick("浏览工作区文件，点开即看内容", "Browse workspace files and tap to view")}
                  </Text>
                </View>
                <Icon name="chevron-right" size={14} color={t.inkFaint} />
              </PressableScale>
              <PressableScale
                scaleTo={0.97}
                onPress={() => setMode("agents")}
                accessibilityRole="button"
                accessibilityLabel={pick("打开子智能体", "Open subagents")}
                style={[
                  styles.capsule,
                  {
                    backgroundColor: t.card,
                    borderColor: t.hairlineStrong,
                    ...t.elevation.card,
                  },
                ]}
              >
                <View style={[styles.capsuleIcon, { backgroundColor: t.brandSoft }]}>
                  <Icon name="users" size={19} color={t.brand} />
                </View>
                <View style={styles.capsuleCol}>
                  <Text style={[styles.capsuleTitle, { color: t.ink }]}>{pick("子智能体", "Subagents")}</Text>
                  <Text style={[styles.capsuleDetail, { color: t.inkSub }]}>
                    {pick("本会话派出的子智能体与消息流", "Subagents spawned in this session and their transcripts")}
                  </Text>
                </View>
                <Icon name="chevron-right" size={14} color={t.inkFaint} />
              </PressableScale>
            </View>
          ) : mode === "files" ? (
            workspacePath === null ? (
              /* 没有项目工作区：文件模式整块空态。 */
              <Text style={[styles.emptyText, { color: t.inkFaint, paddingHorizontal: space(3.5) }]}>
                {pick("没有项目工作区", "No project workspace")}
              </Text>
            ) : (
            <View style={styles.content}>
              <ScrollView
                style={styles.flex1}
                contentContainerStyle={styles.scroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* 文件：路径面包屑 + 刷新 + 搜索井 + 懒展开目录树 */}
                <View style={styles.sectionHead}>
                  <View
                    style={[
                      styles.breadcrumbPill,
                      { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
                    ]}
                  >
                    <Icon name="folder" size={12} color={t.brand} />
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="head"
                      style={[styles.sectionTitle, { color: t.inkSub }]}
                    >
                      {normalizeEntry(workspacePath) || pick("工作区根目录", "Workspace root")}
                    </Text>
                  </View>
                  <PressableScale
                    scaleTo={0.94}
                    onPress={refreshTree}
                    accessibilityRole="button"
                    accessibilityLabel={pick("刷新文件列表", "Refresh file list")}
                    hitSlop={6}
                    style={[
                      styles.sectionAction,
                      { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
                    ]}
                  >
                    <Icon name="refresh" size={13} color={t.inkSub} />
                  </PressableScale>
                </View>
                <View
                  style={[
                    styles.search,
                    {
                      backgroundColor: t.surfaceSoft,
                      borderColor: searchFocused ? t.brand : t.hairline,
                    },
                  ]}
                >
                  <Icon name="search" size={13} color={t.inkGhost} />
                  <TextInput
                    ref={searchRef}
                    value={search}
                    onChangeText={setSearch}
                    placeholder={pick("搜索文件名", "Search file names")}
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
                      accessibilityLabel={pick("清除搜索", "Clear search")}
                      hitSlop={8}
                    >
                      <Icon name="x" size={13} color={t.inkGhost} />
                    </Pressable>
                  ) : null}
                </View>
                {rootError ? (
                  <Text style={[styles.emptyText, { color: t.red }]}>
                    {pick("读不了工作区：", "Can't read workspace: ")}
                    {rootError}
                  </Text>
                ) : query.length > 0 ? (
                  searching ? (
                    <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                      {pick("搜索中…", "Searching…")}
                    </Text>
                  ) : searchResults && searchResults.length > 0 ? (
                    searchResults.map((node) => (
                      <PressableScale
                        key={node.relPath}
                        scaleTo={0.98}
                        onPress={() => openFile(node)}
                        accessibilityRole="button"
                        accessibilityLabel={pick(`打开文件 ${node.name}`, `Open file ${node.name}`)}
                        style={({ pressed }) => [
                          styles.row,
                          {
                            paddingLeft: space(2),
                            backgroundColor: pressed ? t.hover : "transparent",
                          },
                        ]}
                      >
                        <Icon name="doc" size={15} color={t.inkSub} />
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          style={[styles.rowText, { color: t.ink }]}
                        >
                          {node.relPath}
                        </Text>
                        {typeof node.size === "number" ? (
                          <Text style={[styles.rowMeta, { color: t.inkGhost }]}>
                            {formatSize(node.size)}
                          </Text>
                        ) : null}
                      </PressableScale>
                    ))
                  ) : (
                    <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                      {pick("没有匹配的文件", "No matching files")}
                    </Text>
                  )
                ) : rootNodes === null ? (
                  <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                    {pick("读取中…", "Loading…")}
                  </Text>
                ) : rootNodes.length === 0 ? (
                  <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                    {pick("工作区是空的", "Workspace is empty")}
                  </Text>
                ) : (
                  renderTreeRows(rootNodes, 0)
                )}
              </ScrollView>

              {/* 2. 查看层：点文件后覆盖整个内容区（水平轻滑入 + 顶栏返回 + 文件名 + 按类型渲染）。 */}
              {viewer ? (() => {
                const viewerKind = kindOf(viewer.node.name);
                const canMaximize =
                  isWebViewerKind(viewerKind) &&
                  viewer.content !== null &&
                  !viewer.error &&
                  !viewer.binaryNotice;
                const webHtml =
                  viewer.content === null
                    ? ""
                    : viewerKind === "svg"
                      ? svgHtml(viewer.content)
                      : viewer.content;
                return (
                  <Animated.View
                    entering={FadeInRight.duration(180)}
                    style={[styles.viewerLayer, { backgroundColor: t.card }]}
                  >
                    <View style={[styles.viewerHead, { borderBottomColor: t.hairline }]}>
                      <PressableScale
                        scaleTo={0.94}
                        onPress={() => {
                          setViewerFullscreen(false);
                          setViewer(null);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={pick("返回文件列表", "Back to files")}
                        hitSlop={6}
                        style={styles.viewerBack}
                      >
                        <Icon name="chevron-left" size={15} color={t.inkSub} />
                      </PressableScale>
                      <Text numberOfLines={1} style={[styles.viewerTitle, { color: t.ink }]}>
                        {viewer.node.name}
                      </Text>
                      <Text style={[styles.viewerKind, { color: t.inkFaint }]}>
                        {kindLabel(viewerKind)}
                      </Text>
                      {canMaximize ? (
                        <PressableScale
                          scaleTo={0.94}
                          onPress={() => setViewerFullscreen(true)}
                          accessibilityRole="button"
                          accessibilityLabel={pick("全屏查看文档", "View document full screen")}
                          hitSlop={6}
                          style={[
                            styles.viewerAction,
                            { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
                          ]}
                        >
                          <Icon name="maximize" size={13} color={t.inkSub} />
                        </PressableScale>
                      ) : null}
                    </View>
                    <View style={styles.viewerBody}>
                      {viewer.error ? (
                        <Text style={[styles.viewerHint, { color: t.red }]}>
                          {pick("读不出来：", "Couldn't read: ")}
                          {viewer.error}
                        </Text>
                      ) : viewerKind === "image" ? (
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
                        <Text style={[styles.viewerHint, { color: t.inkFaint }]}>
                          {pick("读取中…", "Loading…")}
                        </Text>
                      ) : viewer.binaryNotice ? (
                        <View style={styles.binaryWrap}>
                          <Icon name="doc" size={28} color={t.inkGhost} />
                          <Text style={[styles.binaryTitle, { color: t.inkSub }]}>
                            {pick("二进制文件，不支持纯文本预览", "Binary file; plain-text preview isn't supported")}
                          </Text>
                          <Text style={[styles.binaryDetail, { color: t.inkFaint }]}>
                            {pick(
                              "支持直接预览 Word (.docx)、Excel (.xlsx)、PPT (.pptx)、PDF、Markdown、HTML、SVG、图片与纯文本文件。",
                              "Previews Word (.docx), Excel (.xlsx), PPT (.pptx), PDF, Markdown, HTML, SVG, images and plain text.",
                            )}
                          </Text>
                        </View>
                      ) : viewerKind === "md" ? (
                        <ScrollView
                          contentContainerStyle={styles.mdWrap}
                          showsVerticalScrollIndicator={false}
                        >
                          <MessageMarkdown text={viewer.content} />
                        </ScrollView>
                      ) : isWebViewerKind(viewerKind) ? (
                        <WebView
                          originWhitelist={["*"]}
                          source={{ html: webHtml }}
                          style={[
                            styles.viewerWeb,
                            isOfficeKind(viewerKind) ? { backgroundColor: t.card } : null,
                          ]}
                        />
                      ) : (
                        <ScrollView
                          contentContainerStyle={styles.mdWrap}
                          showsVerticalScrollIndicator={false}
                        >
                          <Text selectable style={[styles.textBody, { color: t.ink }]}>
                            {viewer.content}
                            {viewer.truncated
                              ? pick(
                                  "\n\n——已截断：文件超过 100KB，只显示前 100KB。",
                                  "\n\n— Truncated: file exceeds 100KB; showing the first 100KB.",
                                )
                              : ""}
                          </Text>
                        </ScrollView>
                      )}
                    </View>
                  </Animated.View>
                );
              })() : null}
            </View>
            )
          ) : transcriptAgent ? (
            /* 子会话消息流：面板内只读订阅（独立 connectionId，不占主订阅槽）。 */
            <Animated.View entering={FadeInRight.duration(180)} style={styles.flex1}>
              <SubagentTranscript
                sessionId={transcriptAgent.childSessionId as string}
                agentName={transcriptAgent.name}
              />
            </Animated.View>
          ) : (
            /* 子智能体：瓦片脸列表；有子会话的行点进来**在面板内**看消息流。 */
            <Animated.View entering={FadeIn.duration(150)} style={styles.flex1}>
            <ScrollView
              style={styles.flex1}
              contentContainerStyle={styles.scroll}
              showsVerticalScrollIndicator={false}
            >
              {subagents.length === 0 ? (
                <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                  {pick("本会话还没有派出子智能体", "No subagents in this session yet")}
                </Text>
              ) : (
                subagents.map((agent) => {
                  const openable = Boolean(agent.childSessionId);
                  const row = (
                    <>
                      <AgentFace name={agent.name} status={agent.status} size={24} badge />
                      <View style={styles.agentCol}>
                        <View style={styles.agentTop}>
                          <Text numberOfLines={1} style={[styles.agentName, { color: t.ink }]}>
                            {agent.name}
                          </Text>
                          <View
                            style={[
                              styles.agentStatusBadge,
                              { backgroundColor: t.card, borderColor: t.hairline },
                            ]}
                          >
                            <Text
                              style={[styles.agentStatus, { color: statusColor(agent.status) }]}
                            >
                              {statusText(agent.status)}
                            </Text>
                          </View>
                        </View>
                        {agent.summary ? (
                          <Text
                            numberOfLines={2}
                            style={[styles.agentSummary, { color: t.inkSub }]}
                          >
                            {agent.summary}
                          </Text>
                        ) : null}
                      </View>
                      {openable ? (
                        <Icon name="chevron-right" size={14} color={t.inkFaint} />
                      ) : null}
                    </>
                  );
                  return openable ? (
                    <PressableScale
                      key={agent.key}
                      scaleTo={0.98}
                      onPress={() => setTranscriptAgent(agent)}
                      accessibilityRole="button"
                      accessibilityLabel={pick(`查看 ${agent.name} 的消息流`, `View ${agent.name}'s transcript`)}
                      style={({ pressed }) => [
                        styles.agentRow,
                        {
                          backgroundColor: pressed ? t.hover : t.surfaceSoft,
                          borderColor: t.hairline,
                        },
                      ]}
                    >
                      {row}
                    </PressableScale>
                  ) : (
                    <View
                      key={agent.key}
                      style={[
                        styles.agentRow,
                        { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
                      ]}
                    >
                      {row}
                    </View>
                  );
                })
              )}
            </ScrollView>
            </Animated.View>
          )}
        </Animated.View>
      </Animated.View>
      </GestureDetector>

      {/* 文档/网页全屏预览（便于手机横滑看宽表格、长文档与幻灯片）。 */}
      {viewer && viewerFullscreen && viewer.content !== null && isWebViewerKind(kindOf(viewer.node.name)) ? (
        <Modal
          visible
          animationType="fade"
          statusBarTranslucent
          supportedOrientations={[...SUPPORTED_MODAL_ORIENTATIONS]}
          onRequestClose={() => setViewerFullscreen(false)}
        >
          <View
            style={[
              styles.fullscreenRoot,
              {
                backgroundColor: t.card,
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
                paddingLeft: insets.left,
                paddingRight: insets.right,
              },
            ]}
          >
            <View style={[styles.viewerHead, { borderBottomColor: t.hairline }]}>
              <Text numberOfLines={1} style={[styles.viewerTitle, { color: t.ink }]}>
                {viewer.node.name}
              </Text>
              <Text style={[styles.viewerKind, { color: t.inkFaint }]}>
                {kindLabel(kindOf(viewer.node.name))}
              </Text>
              <PressableScale
                scaleTo={0.94}
                onPress={() => setViewerFullscreen(false)}
                accessibilityRole="button"
                accessibilityLabel={pick("退出全屏预览", "Exit full-screen preview")}
                hitSlop={6}
                style={[
                  styles.viewerAction,
                  { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
                ]}
              >
                <Icon name="x" size={14} color={t.inkSub} />
              </PressableScale>
            </View>
            <WebView
              originWhitelist={["*"]}
              source={{
                html:
                  kindOf(viewer.node.name) === "svg"
                    ? svgHtml(viewer.content)
                    : viewer.content,
              }}
              style={[
                styles.viewerWeb,
                isOfficeKind(kindOf(viewer.node.name)) ? { backgroundColor: t.card } : null,
              ]}
            />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

/** 子会话消息流（只读）：独立 Topic 订阅，主会话的订阅/对账完全不受影响。 */
function SubagentTranscript({
  sessionId,
  agentName,
}: {
  sessionId: string;
  agentName: string;
}) {
  const t = useNibiTheme();
  const { pick } = useI18n();
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);

  useEffect(() => {
    let alive = true;
    const client = currentKernelClient();
    if (!client) {
      setError(
        pick(
          "内核还没就绪：先回首页打开一个会话。",
          "Kernel isn't ready yet. Open a session on the home screen first.",
        ),
      );
      return;
    }
    const feed = new ConversationFeed(client);
    const off = feed.subscribe(() => {
      const snapshot = feed.snapshot;
      if (alive && snapshot) setRows(deriveRows(snapshot));
    });
    void feed
      .start(sessionId, { readOnly: true })
      .catch((cause: unknown) => {
        if (alive) {
          setError(
            pick("读取子会话失败：", "Couldn't load subagent session: ") +
              (cause instanceof Error ? cause.message : String(cause)),
          );
        }
      });
    return () => {
      alive = false;
      off();
      void feed.stop();
    };
  }, [sessionId, pick]);

  // process 折叠与工具组摊平：面板里不做折叠交互，按时间顺序直出。
  const flat = useMemo(() => {
    const out: ChatRow[] = [];
    const walk = (list: readonly ChatRow[]) => {
      for (const row of list) {
        if (row.kind === "process") walk(row.rows);
        else if (row.kind === "toolGroup") out.push(...row.tools);
        else out.push(row);
      }
    };
    walk(rows);
    return out;
  }, [rows]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.flex1}
      contentContainerStyle={styles.transcript}
      showsVerticalScrollIndicator={false}
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
    >
      {error ? (
        <Text style={[styles.emptyText, { color: t.red }]}>{error}</Text>
      ) : flat.length === 0 ? (
        <Text style={[styles.emptyText, { color: t.inkFaint }]}>
          {pick(`${agentName} 还没有消息`, `No messages from ${agentName} yet`)}
        </Text>
      ) : (
        flat.map((row) => {
          if (row.kind === "user") {
            return (
              <View
                key={row.key}
                style={[styles.transcriptUser, { backgroundColor: t.brandSoft }]}
              >
                <Text style={[styles.transcriptText, { color: t.ink }]}>{row.text}</Text>
              </View>
            );
          }
          if (row.kind === "assistant") {
            if (row.text.trim().length === 0) return null;
            return (
              <View key={row.key} style={styles.transcriptAssistant}>
                <MessageMarkdown text={row.text} />
              </View>
            );
          }
          if (row.kind === "tool") {
            return (
              <View key={row.key} style={styles.transcriptTool}>
                <Icon name="wrench" size={11} color={t.inkGhost} />
                <Text numberOfLines={1} style={[styles.transcriptToolText, { color: t.inkFaint }]}>
                  {row.name}
                  {row.status === "error" ? pick(" · 失败", " · failed") : ""}
                </Text>
              </View>
            );
          }
          if (row.kind === "subagent") {
            return (
              <View key={row.key} style={styles.transcriptTool}>
                <AgentFace name={row.subagentType} status="completed" size={14} />
                <Text numberOfLines={1} style={[styles.transcriptToolText, { color: t.inkFaint }]}>
                  {pick("子智能体", "Subagent")} · {row.subagentType}
                </Text>
              </View>
            );
          }
          if (row.kind === "notice") {
            return (
              <Text key={row.key} style={[styles.transcriptNote, { color: t.inkFaint }]}>
                {row.text}
              </Text>
            );
          }
          // turn 脚注/审批卡等在只读面板里不渲染。
          return null;
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  transcript: { paddingHorizontal: space(3.5), paddingVertical: space(2), gap: space(2) },
  transcriptUser: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    borderRadius: radius.card,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  transcriptText: { ...text("small") },
  transcriptAssistant: { gap: space(1) },
  transcriptTool: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  transcriptToolText: { flexShrink: 1, ...text("micro") },
  transcriptNote: { ...text("micro") },
  headBack: {
    width: size.chipLg,
    height: size.chipLg,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginRight: space(0.5),
  },
  // 一级胶囊入口（对齐 NIBI 客户端右侧面板的卡片语义）
  hub: { paddingHorizontal: space(3.5), paddingTop: space(1.5), gap: space(2.5) },
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3.5),
  },
  capsuleIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  capsuleCol: { flex: 1, minWidth: 0, gap: 3 },
  capsuleTitle: { ...text("bodyLg"), fontWeight: "700" },
  capsuleDetail: { ...text("micro") },
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
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1 },
  scroll: { paddingHorizontal: space(3.5), paddingBottom: space(4) },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingTop: space(1.5),
    paddingBottom: space(2),
  },
  breadcrumbPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    minHeight: size.chipLg,
    paddingHorizontal: space(2.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: {
    flex: 1,
    ...text("micro"),
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  sectionAction: {
    width: size.chipLg,
    height: size.chipLg,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  // 搜索井：surfaceSoft 内嵌面，聚焦把发丝线高亮。
  search: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    marginBottom: space(2),
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, ...text("small"), padding: 0 },
  // 紧凑文件行：38px 档，清晰可点。
  row: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingVertical: space(1.5),
    paddingRight: space(2),
    borderRadius: radius.control,
    marginBottom: 2,
  },
  rowStub: { width: 12 },
  rowText: { flex: 1, ...text("small") },
  rowMeta: { ...text("micro") },
  rowHint: { ...text("micro"), paddingVertical: space(1) },
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
  viewerAction: {
    width: size.chip,
    height: size.chip,
    borderRadius: radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerBody: { flex: 1 },
  viewerWeb: { flex: 1, backgroundColor: "#ffffff" },
  viewerHint: { ...text("small"), padding: space(3.5) },
  binaryWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space(5),
    gap: space(2),
  },
  binaryTitle: { ...text("body"), fontWeight: "600", textAlign: "center" },
  binaryDetail: { ...text("micro"), textAlign: "center", lineHeight: 18 },
  fullscreenRoot: { flex: 1 },
  mdWrap: { padding: space(3.5), paddingBottom: space(6) },
  textBody: { ...text("small"), fontFamily: "monospace" },
  imageWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space(2),
  },
  // 子智能体卡片行：脸 24 + 名字/状态徽标一行 + 摘要两行。
  agentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: space(2),
  },
  agentCol: { flex: 1, minWidth: 0, gap: 3 },
  agentTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
  },
  agentName: { flex: 1, ...text("small"), fontWeight: "700" },
  agentStatusBadge: {
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(2),
    paddingVertical: 1,
  },
  agentStatus: { ...text("micro"), fontWeight: "700" },
  agentSummary: { ...text("micro") },
});
