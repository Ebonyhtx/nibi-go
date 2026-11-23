// 消息流、审批卡与使用统计共用的「用户口径」工具名称、图标与目标摘要。
//
// 原则：不向终端用户裸露 `mcp__phone__tap`、`Bash`、`{"index":3}` 等工程标识符或原始 JSON，
// 统一翻译为自然的中文动作描述，同时保留展开查看原始参数详情的能力。

import type { IconName } from "../components/Icon";
import { pickText } from "../i18n";

interface BiText {
  zh: string;
  en: string;
}

function pickBi(entry: BiText): string {
  return pickText(entry.zh, entry.en);
}

/** 参数 JSON（可能被 120 字截断）里抓一个字符串键的值；不要求闭合引号。 */
export function paramStringOf(raw: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, "u").exec(raw);
  if (!match) return undefined;
  return match[1]
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\(.)/gu, "$1")
    .trim();
}

/** 参数 JSON 里抓一个数字或布尔键的值。 */
export function paramPrimitiveOf(raw: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*([0-9]+|true|false)`, "u").exec(raw);
  return match?.[1];
}

function cap(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function baseName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
}

/** 剥离 `mcp__<server>__<tool>` 前缀，返回规范化短名与服务器名。 */
export function splitMcpToolName(rawName: string): {
  server?: string;
  tool: string;
  isPhone: boolean;
} {
  const trimmed = rawName.trim();
  const mcpMatch = /^mcp__([a-zA-Z0-9_-]+)__(.+)$/u.exec(trimmed);
  if (mcpMatch) {
    const server = mcpMatch[1]!;
    const tool = mcpMatch[2]!;
    return {
      server,
      tool,
      isPhone: server === "phone" || server === "nibi_phone" || server === "nibiphone",
    };
  }
  return {
    tool: trimmed,
    isPhone: trimmed.startsWith("phone_") || trimmed.startsWith("phone."),
  };
}

const PHONE_TOOL_LABELS: Record<string, BiText> = {
  apps: { zh: "查看手机应用", en: "List phone apps" },
  list_apps: { zh: "查看手机应用", en: "List phone apps" },
  open: { zh: "打开手机应用或网页", en: "Open phone app or webpage" },
  open_app: { zh: "打开手机应用或网页", en: "Open phone app or webpage" },
  screen: { zh: "读取手机屏幕", en: "Read phone screen" },
  screen_tree: { zh: "读取手机屏幕", en: "Read phone screen" },
  tap: { zh: "点按手机屏幕", en: "Tap phone screen" },
  click: { zh: "点按手机屏幕", en: "Tap phone screen" },
  type: { zh: "在手机输入文字", en: "Type text on phone" },
  type_text: { zh: "在手机输入文字", en: "Type text on phone" },
  scroll: { zh: "滑动手机屏幕", en: "Scroll phone screen" },
  swipe: { zh: "滑动手机屏幕", en: "Swipe phone screen" },
  key: { zh: "按下手机按键", en: "Press phone key" },
  press_key: { zh: "按下手机按键", en: "Press phone key" },
  screenshot: { zh: "截取手机屏幕", en: "Take phone screenshot" },
  android_shell: { zh: "执行手机系统命令", en: "Run phone shell command" },
  shell: { zh: "执行手机系统命令", en: "Run phone shell command" },
};

const PHONE_APPROVAL_TITLES: Record<string, BiText> = {
  apps: { zh: "允许查看手机上的应用列表？", en: "Allow viewing installed phone apps?" },
  list_apps: { zh: "允许查看手机上的应用列表？", en: "Allow viewing installed phone apps?" },
  open: { zh: "允许打开手机应用或网页？", en: "Allow opening a phone app or webpage?" },
  open_app: { zh: "允许打开手机应用或网页？", en: "Allow opening a phone app or webpage?" },
  screen: { zh: "允许读取当前手机屏幕内容？", en: "Allow reading current phone screen content?" },
  screen_tree: { zh: "允许读取当前手机屏幕内容？", en: "Allow reading current phone screen content?" },
  tap: { zh: "允许点按手机屏幕上的元素？", en: "Allow tapping an element on the phone screen?" },
  click: { zh: "允许点按手机屏幕上的元素？", en: "Allow tapping an element on the phone screen?" },
  type: { zh: "允许在手机输入框填入文字？", en: "Allow typing text into a phone input field?" },
  type_text: { zh: "允许在手机输入框填入文字？", en: "Allow typing text into a phone input field?" },
  scroll: { zh: "允许滑动手机屏幕？", en: "Allow scrolling the phone screen?" },
  swipe: { zh: "允许滑动手机屏幕？", en: "Allow scrolling the phone screen?" },
  key: { zh: "允许执行手机系统按键？", en: "Allow pressing a phone system key?" },
  press_key: { zh: "允许执行手机系统按键？", en: "Allow pressing a phone system key?" },
  screenshot: { zh: "允许截取当前手机屏幕画面？", en: "Allow taking a screenshot of the phone screen?" },
  android_shell: { zh: "允许在手机上执行这条系统命令？", en: "Allow running this shell command on the phone?" },
  shell: { zh: "允许在手机上执行这条系统命令？", en: "Allow running this shell command on the phone?" },
};

const BUILTIN_TOOL_LABELS: Record<string, BiText> = {
  Bash: { zh: "运行终端命令", en: "Run terminal command" },
  bash: { zh: "运行终端命令", en: "Run terminal command" },
  PowerShell: { zh: "运行终端命令", en: "Run terminal command" },
  pwsh: { zh: "运行终端命令", en: "Run terminal command" },
  shell: { zh: "运行终端命令", en: "Run terminal command" },
  Read: { zh: "读取文件", en: "Read file" },
  read: { zh: "读取文件", en: "Read file" },
  Write: { zh: "写入文件", en: "Write file" },
  write: { zh: "写入文件", en: "Write file" },
  Edit: { zh: "修改文件", en: "Edit file" },
  edit: { zh: "修改文件", en: "Edit file" },
  str_replace_editor: { zh: "修改文件", en: "Edit file" },
  NotebookEdit: { zh: "编辑笔记本", en: "Edit notebook" },
  Grep: { zh: "搜索文件内容", en: "Search file contents" },
  grep: { zh: "搜索文件内容", en: "Search file contents" },
  Glob: { zh: "查找文件", en: "Find files" },
  glob: { zh: "查找文件", en: "Find files" },
  WebFetch: { zh: "读取网页内容", en: "Fetch webpage" },
  web_fetch: { zh: "读取网页内容", en: "Fetch webpage" },
  WebSearch: { zh: "联网搜索", en: "Web search" },
  web_search: { zh: "联网搜索", en: "Web search" },
  TodoWrite: { zh: "更新任务清单", en: "Update task list" },
  TodoRead: { zh: "查看任务清单", en: "Read task list" },
  Skill: { zh: "调用技能", en: "Run skill" },
  Agent: { zh: "派发子智能体", en: "Dispatch subagent" },
  AskUserQuestion: { zh: "向你确认问题", en: "Ask for confirmation" },
  EnterPlanMode: { zh: "进入计划模式", en: "Enter plan mode" },
  ExitPlanMode: { zh: "提交实现计划", en: "Submit plan" },
  TaskOutput: { zh: "读取后台任务结果", en: "Read background task output" },
  TaskStop: { zh: "停止后台任务", en: "Stop background task" },
  SendMessage: { zh: "发送子智能体消息", en: "Message subagent" },
  CronCreate: { zh: "创建定时任务", en: "Create scheduled task" },
  CronList: { zh: "查看定时任务", en: "List scheduled tasks" },
  CronUpdate: { zh: "更新定时任务", en: "Update scheduled task" },
  CronDelete: { zh: "删除定时任务", en: "Delete scheduled task" },
  OffPeakCreate: { zh: "创建闲时任务", en: "Create off-peak task" },
  OffPeakList: { zh: "查看闲时任务", en: "List off-peak tasks" },
  CreateWorkflow: { zh: "运行自动化工作流", en: "Run workflow" },
  AmendWorkflow: { zh: "修订工作流", en: "Amend workflow" },
  SaveWorkflow: { zh: "保存工作流", en: "Save workflow" },
  EvalWorkflowSnippet: { zh: "执行工作流片段", en: "Evaluate workflow snippet" },
  ListWorkflowRuns: { zh: "查看工作流记录", en: "List workflow runs" },
  GetWorkflowRun: { zh: "查询工作流状态", en: "Check workflow status" },
  ResumeWorkflowRun: { zh: "继续运行工作流", en: "Resume workflow" },
  ResolveWorkflowQuestion: { zh: "回答工作流提问", en: "Answer workflow question" },
  FillWorkflowHole: { zh: "补全工作流步骤", en: "Fill workflow step" },
  ListSavedWorkflows: { zh: "查看已存工作流", en: "List saved workflows" },
  SearchPlugins: { zh: "搜索插件", en: "Search plugins" },
  SuggestPluginInstall: { zh: "推荐安装插件", en: "Suggest plugin install" },
  ListSessions: { zh: "查看会话列表", en: "List sessions" },
  ReadSession: { zh: "读取会话记录", en: "Read session history" },
  CreateSession: { zh: "创建协同会话", en: "Create session" },
  ForkSession: { zh: "建立分支会话", en: "Fork session" },
  SendToSession: { zh: "向会话发送指令", en: "Send to session" },
  WaitSessions: { zh: "等待会话完成", en: "Wait for sessions" },
  InterruptSession: { zh: "停止目标会话", en: "Interrupt session" },
  RenameSession: { zh: "重命名会话", en: "Rename session" },
  ListProjects: { zh: "查看项目列表", en: "List projects" },
  OpenSession: { zh: "切换会话", en: "Switch session" },
  SetSessionArchived: { zh: "归档会话", en: "Archive session" },
  SetSessionPinned: { zh: "置顶会话", en: "Pin session" },
  ListModels: { zh: "查看可用模型", en: "List available models" },
  ReadTopicResource: { zh: "读取会话附件", en: "Read session attachment" },
  // 官方文档四件套与内置插件 MCP 工具名
  docx_create: { zh: "生成 Word 文档", en: "Create Word document" },
  create_docx: { zh: "生成 Word 文档", en: "Create Word document" },
  docx_inspect: { zh: "解析 Word 文档", en: "Inspect Word document" },
  inspect_docx: { zh: "解析 Word 文档", en: "Inspect Word document" },
  xlsx_create: { zh: "生成 Excel 表格", en: "Create Excel spreadsheet" },
  create_xlsx: { zh: "生成 Excel 表格", en: "Create Excel spreadsheet" },
  xlsx_analyze: { zh: "分析表格数据", en: "Analyze spreadsheet" },
  analyze_xlsx: { zh: "分析表格数据", en: "Analyze spreadsheet" },
  pptx_create: { zh: "生成 PPT 演示文稿", en: "Create PowerPoint deck" },
  create_pptx: { zh: "生成 PPT 演示文稿", en: "Create PowerPoint deck" },
  pptx_inspect: { zh: "解析 PPT 演示大纲", en: "Inspect PowerPoint deck" },
  inspect_pptx: { zh: "解析 PPT 演示大纲", en: "Inspect PowerPoint deck" },
  pdf_create: { zh: "生成 PDF 文档", en: "Create PDF document" },
  create_pdf: { zh: "生成 PDF 文档", en: "Create PDF document" },
  pdf_inspect: { zh: "提取 PDF 文档内容", en: "Extract PDF content" },
  inspect_pdf: { zh: "提取 PDF 文档内容", en: "Extract PDF content" },
  chart_render: { zh: "生成可视化图表", en: "Render chart" },
  render_chart: { zh: "生成可视化图表", en: "Render chart" },
  design_palette: { zh: "生成界面设计方案", en: "Generate UI palette" },
  workspace_scan: { zh: "扫描项目结构", en: "Scan project structure" },
  weather_get: { zh: "查询城市天气", en: "Check weather" },
  hello: { zh: "插件问候测试", en: "Plugin greeting test" },
};

const SERVER_LABELS: Record<string, BiText> = {
  nibigo_documents: { zh: "Word 文档", en: "Word Docs" },
  documents: { zh: "Word 文档", en: "Word Docs" },
  nibigo_spreadsheets: { zh: "Excel 表格", en: "Excel Sheets" },
  spreadsheets: { zh: "Excel 表格", en: "Excel Sheets" },
  nibigo_presentations: { zh: "PPT 演示", en: "PowerPoint" },
  presentations: { zh: "PPT 演示", en: "PowerPoint" },
  nibigo_pdf: { zh: "PDF 工具箱", en: "PDF Tools" },
  pdf: { zh: "PDF 工具箱", en: "PDF Tools" },
  nibigo_visualize: { zh: "图表可视化", en: "Charts" },
  visualize: { zh: "图表可视化", en: "Charts" },
  nibigo_design: { zh: "界面设计", en: "UI Design" },
  design: { zh: "界面设计", en: "UI Design" },
  nibigo_toolkit: { zh: "项目体检", en: "Project Toolkit" },
  toolkit: { zh: "项目体检", en: "Project Toolkit" },
  nibigo_weather: { zh: "天气查询", en: "Weather" },
  market_hello: { zh: "市场插件", en: "Market Plugin" },
};

/** 工具名 → 面向用户的中文名称（绝不原样露出 `mcp__phone__*`）。 */
export function friendlyToolName(rawName: string, detail?: string): string {
  if (!rawName) return pickText("工具调用", "Tool call");
  const { server, tool, isPhone } = splitMcpToolName(rawName);
  const cleanTool = tool.replace(/^phone[._]/u, "");

  if (isPhone || ( !server && cleanTool in PHONE_TOOL_LABELS && rawName.startsWith("phone") )) {
    if (
      (cleanTool === "tap" || cleanTool === "click") &&
      detail &&
      (paramPrimitiveOf(detail, "long_press") === "true" || paramPrimitiveOf(detail, "long") === "true")
    ) {
      return pickText("长按手机屏幕", "Long-press phone screen");
    }
    if ((cleanTool === "open" || cleanTool === "open_app") && detail) {
      if (paramStringOf(detail, "url")) return pickText("在手机打开网页", "Open webpage on phone");
      if (paramStringOf(detail, "package") || paramStringOf(detail, "app")) {
        return pickText("打开手机应用", "Open phone app");
      }
    }
    const phoneLabel = PHONE_TOOL_LABELS[cleanTool];
    return phoneLabel
      ? pickBi(phoneLabel)
      : pickText(`手机操控 · ${cleanTool}`, `Phone control · ${cleanTool}`);
  }

  if (BUILTIN_TOOL_LABELS[rawName]) return pickBi(BUILTIN_TOOL_LABELS[rawName]!);
  if (BUILTIN_TOOL_LABELS[cleanTool]) return pickBi(BUILTIN_TOOL_LABELS[cleanTool]!);

  if (server) {
    const knownServer = SERVER_LABELS[server];
    const serverLabel = knownServer
      ? pickBi(knownServer)
      : server
          .replace(/^nibigo_/u, "")
          .replace(/[_-]+/gu, " ")
          .trim();
    const toolReadable = cleanTool.replace(/[_-]+/gu, " ").trim();
    return `${serverLabel} · ${toolReadable}`;
  }

  return rawName;
}

/** 工具名 → 专属图标。 */
export function friendlyToolIcon(rawName: string, detail?: string): IconName {
  const { tool, isPhone } = splitMcpToolName(rawName);
  const cleanTool = tool.replace(/^phone[._]/u, "");

  if (isPhone) {
    if (cleanTool === "screenshot") return "image";
    if (cleanTool === "android_shell") return "terminal";
    if (cleanTool === "type") return "pen";
    if (cleanTool === "open" && detail && paramStringOf(detail, "url")) return "globe";
    return "phone";
  }

  switch (cleanTool) {
    case "Bash":
    case "bash":
    case "PowerShell":
    case "pwsh":
    case "shell":
      return "terminal";
    case "Read":
    case "read":
    case "Write":
    case "write":
    case "NotebookEdit":
    case "EnterPlanMode":
    case "docx_create":
    case "docx_inspect":
    case "xlsx_create":
    case "xlsx_analyze":
    case "pptx_create":
    case "pptx_inspect":
    case "pdf_create":
    case "pdf_inspect":
      return "doc";
    case "Edit":
    case "edit":
    case "str_replace_editor":
      return "pen";
    case "Grep":
    case "grep":
    case "workspace_scan":
    case "SearchPlugins":
      return "search";
    case "Glob":
    case "glob":
    case "ListProjects":
      return "folder";
    case "WebFetch":
    case "web_fetch":
    case "WebSearch":
    case "web_search":
    case "deepseek_search":
    case "deepseek_fetch":
    case "weather_get":
      return "globe";
    case "TodoWrite":
    case "TodoRead":
    case "ExitPlanMode":
      return "checklist";
    case "Skill":
    case "chart_render":
    case "design_palette":
    case "CreateWorkflow":
    case "AmendWorkflow":
    case "SaveWorkflow":
    case "EvalWorkflowSnippet":
      return "sparkles";
    case "AskUserQuestion":
    case "ResolveWorkflowQuestion":
      return "question";
    case "TaskStop":
    case "InterruptSession":
      return "stop";
    case "TaskOutput":
    case "CronCreate":
    case "CronList":
    case "CronUpdate":
    case "CronDelete":
    case "OffPeakCreate":
    case "OffPeakList":
      return "clock";
    case "SendMessage":
    case "SendToSession":
      return "comment";
    case "SuggestPluginInstall":
      return "puzzle";
    default:
      return "wrench";
  }
}

/** 审批卡片标题 → 用户口径中文询问句。 */
export function friendlyApprovalTitle(rawName: string): string {
  if (!rawName) return pickText("允许执行这项操作？", "Allow this action?");
  const { tool, isPhone } = splitMcpToolName(rawName);
  const cleanTool = tool.replace(/^phone[._]/u, "");

  if (isPhone && PHONE_APPROVAL_TITLES[cleanTool]) {
    return pickBi(PHONE_APPROVAL_TITLES[cleanTool]!);
  }
  if (PHONE_APPROVAL_TITLES[cleanTool] && rawName.startsWith("phone")) {
    return pickBi(PHONE_APPROVAL_TITLES[cleanTool]!);
  }

  switch (cleanTool) {
    case "Bash":
    case "bash":
    case "PowerShell":
    case "pwsh":
    case "shell":
      return pickText("允许运行这条终端命令？", "Allow running this terminal command?");
    case "Write":
    case "write":
      return pickText("允许创建或写入这个文件？", "Allow creating or writing this file?");
    case "Edit":
    case "edit":
    case "str_replace_editor":
      return pickText("允许修改这个文件？", "Allow editing this file?");
    case "Read":
    case "read":
      return pickText("允许读取这个文件？", "Allow reading this file?");
    case "WebFetch":
    case "web_fetch":
      return pickText("允许访问并读取这个网页？", "Allow fetching this webpage?");
    case "WebSearch":
    case "web_search":
      return pickText("允许进行联网搜索？", "Allow searching the web?");
    default: {
      const label = friendlyToolName(rawName);
      return pickText(`允许执行「${label}」？`, `Allow "${label}"?`);
    }
  }
}

const DIRECTION_LABELS: Record<string, BiText> = {
  up: { zh: "向上滑动", en: "Scroll up" },
  down: { zh: "向下滑动", en: "Scroll down" },
  left: { zh: "向左滑动", en: "Swipe left" },
  right: { zh: "向右滑动", en: "Swipe right" },
};

const PHONE_KEY_LABELS: Record<string, BiText> = {
  back: { zh: "返回键", en: "Back key" },
  home: { zh: "主屏幕键", en: "Home key" },
  recents: { zh: "最近任务键", en: "Recents key" },
  notifications: { zh: "展开通知栏", en: "Expand notifications" },
};

/**
 * 折叠行里的目标摘要：按工具提取用户一眼能读懂的目标（应用名/文字/方向/文件名/命令/网址），
 * 绝不把 `{"index":3}` 等裸 JSON 直接摆进消息流。
 */
export function friendlyToolTarget(
  rawName: string,
  detail: string | undefined,
  todosCount?: number,
): string {
  const raw = detail ?? "";
  if (!raw && !todosCount) return "";
  const { tool, isPhone } = splitMcpToolName(rawName);
  const cleanTool = tool.replace(/^phone[._]/u, "");

  if (isPhone || (rawName.startsWith("phone") && cleanTool in PHONE_TOOL_LABELS)) {
    switch (cleanTool) {
      case "apps": {
        const query = paramStringOf(raw, "query");
        return query
          ? pickText(`筛选：${cap(query, 28)}`, `Filter: ${cap(query, 28)}`)
          : pickText("已安装应用列表", "Installed apps");
      }
      case "open": {
        const app = paramStringOf(raw, "app");
        if (app) return cap(app, 36);
        const url = paramStringOf(raw, "url");
        if (url) return cap(url.replace(/^https?:\/\//u, ""), 44);
        return "";
      }
      case "screen": {
        const cursor = paramStringOf(raw, "cursor");
        return cursor
          ? pickText("翻页读取屏幕内容", "Read next screen page")
          : pickText("获取当前界面元素", "Read current screen elements");
      }
      case "tap": {
        const index = paramPrimitiveOf(raw, "index");
        return index ? pickText(`界面元素 #${index}`, `Element #${index}`) : "";
      }
      case "type": {
        const text = paramStringOf(raw, "text");
        const index = paramPrimitiveOf(raw, "index");
        if (text) return pickText(`“${cap(squash(text), 28)}”`, `"${cap(squash(text), 28)}"`);
        return index ? pickText(`输入框 #${index}`, `Input #${index}`) : "";
      }
      case "scroll": {
        const dir = paramStringOf(raw, "direction");
        const index = paramPrimitiveOf(raw, "index");
        const dirEntry = dir ? DIRECTION_LABELS[dir] : undefined;
        const dirLabel = dirEntry ? pickBi(dirEntry) : (dir ?? pickText("滑动屏幕", "Scroll screen"));
        return index
          ? pickText(`${dirLabel} · 区域 #${index}`, `${dirLabel} · Area #${index}`)
          : dirLabel;
      }
      case "key":
      case "press_key": {
        const keyName = paramStringOf(raw, "name") ?? paramStringOf(raw, "key");
        if (!keyName) return "";
        const keyEntry = PHONE_KEY_LABELS[keyName];
        return keyEntry ? pickBi(keyEntry) : keyName;
      }
      case "screenshot":
        return pickText("当前手机画面", "Current phone screen");
      case "android_shell": {
        const cmd = paramStringOf(raw, "command");
        return cmd ? cap(squash(cmd), 48) : "";
      }
      default:
        break;
    }
  }

  switch (cleanTool) {
    case "Bash":
    case "bash":
    case "PowerShell":
    case "pwsh":
    case "shell": {
      const desc = paramStringOf(raw, "description");
      if (desc && desc.length <= 36) return squash(desc);
      const command = paramStringOf(raw, "command");
      if (command) return cap(squash(command), 52);
      break;
    }
    case "Read":
    case "read":
    case "Write":
    case "write":
    case "Edit":
    case "edit":
    case "str_replace_editor":
    case "NotebookEdit":
    case "docx_create":
    case "create_docx":
    case "docx_inspect":
    case "inspect_docx":
    case "xlsx_create":
    case "create_xlsx":
    case "xlsx_analyze":
    case "analyze_xlsx":
    case "pptx_create":
    case "create_pptx":
    case "pptx_inspect":
    case "inspect_pptx":
    case "pdf_create":
    case "create_pdf":
    case "pdf_inspect":
    case "inspect_pdf": {
      const title = paramStringOf(raw, "title");
      const path =
        paramStringOf(raw, "file_path") ??
        paramStringOf(raw, "output_path") ??
        paramStringOf(raw, "filename") ??
        paramStringOf(raw, "path") ??
        paramStringOf(raw, "notebook_path");
      if (title && path) return `${cap(title, 20)} (${cap(baseName(path), 24)})`;
      if (path) return cap(baseName(path), 40);
      if (title) return cap(title, 36);
      break;
    }
    case "Grep":
    case "grep":
    case "Glob":
    case "glob": {
      const pattern = paramStringOf(raw, "pattern");
      if (pattern) return cap(pattern, 40);
      break;
    }
    case "WebFetch":
    case "web_fetch":
    case "deepseek_fetch":
    case "WebSearch":
    case "web_search":
    case "deepseek_search": {
      const target = paramStringOf(raw, "url") ?? paramStringOf(raw, "query");
      if (target) return cap(target.replace(/^https?:\/\//u, ""), 48);
      break;
    }
    case "Agent": {
      const description = paramStringOf(raw, "description") ?? paramStringOf(raw, "prompt");
      if (description) return cap(squash(description), 40);
      break;
    }
    case "Skill": {
      const skill = paramStringOf(raw, "skill") ?? paramStringOf(raw, "command");
      if (skill) return cap(squash(skill), 40);
      break;
    }
    case "TodoWrite": {
      if (typeof todosCount === "number" && todosCount > 0) {
        return pickText(
          `${todosCount} 项任务`,
          todosCount === 1 ? "1 task" : `${todosCount} tasks`,
        );
      }
      const summary = paramStringOf(raw, "toolSummary") ?? paramStringOf(raw, "content");
      if (summary) return cap(squash(summary), 36);
      return "";
    }
    case "TodoRead":
    case "EnterPlanMode":
    case "ExitPlanMode":
      return "";
    case "AskUserQuestion": {
      const header = paramStringOf(raw, "header") ?? paramStringOf(raw, "question");
      if (header) return cap(squash(header), 36);
      return "";
    }
    default:
      break;
  }

  // 通用提取：如果是 JSON 参数，优先挑常见可读字段，绝不把 `{}` 或裸 JSON 塞进摘要。
  for (const key of [
    "title",
    "name",
    "query",
    "city",
    "path",
    "file_path",
    "url",
    "description",
    "summary",
    "prompt",
    "text",
    "command",
  ]) {
    const val = paramStringOf(raw, key);
    if (val) return cap(squash(val), 40);
  }

  const trimmed = squash(raw);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "";
  }
  return trimmed ? cap(trimmed, 40) : "";
}
