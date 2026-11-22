// 消息流、审批卡与使用统计共用的「用户口径」工具名称、图标与目标摘要。
//
// 原则：不向终端用户裸露 `mcp__phone__tap`、`Bash`、`{"index":3}` 等工程标识符或原始 JSON，
// 统一翻译为自然的中文动作描述，同时保留展开查看原始参数详情的能力。

import type { IconName } from "../components/Icon";

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

const PHONE_TOOL_LABELS: Record<string, string> = {
  apps: "查看手机应用",
  list_apps: "查看手机应用",
  open: "打开手机应用或网页",
  open_app: "打开手机应用或网页",
  screen: "读取手机屏幕",
  screen_tree: "读取手机屏幕",
  tap: "点按手机屏幕",
  click: "点按手机屏幕",
  type: "在手机输入文字",
  type_text: "在手机输入文字",
  scroll: "滑动手机屏幕",
  swipe: "滑动手机屏幕",
  key: "按下手机按键",
  press_key: "按下手机按键",
  screenshot: "截取手机屏幕",
  android_shell: "执行手机系统命令",
  shell: "执行手机系统命令",
};

const PHONE_APPROVAL_TITLES: Record<string, string> = {
  apps: "允许查看手机上的应用列表？",
  list_apps: "允许查看手机上的应用列表？",
  open: "允许打开手机应用或网页？",
  open_app: "允许打开手机应用或网页？",
  screen: "允许读取当前手机屏幕内容？",
  screen_tree: "允许读取当前手机屏幕内容？",
  tap: "允许点按手机屏幕上的元素？",
  click: "允许点按手机屏幕上的元素？",
  type: "允许在手机输入框填入文字？",
  type_text: "允许在手机输入框填入文字？",
  scroll: "允许滑动手机屏幕？",
  swipe: "允许滑动手机屏幕？",
  key: "允许执行手机系统按键？",
  press_key: "允许执行手机系统按键？",
  screenshot: "允许截取当前手机屏幕画面？",
  android_shell: "允许在手机上执行这条系统命令？",
  shell: "允许在手机上执行这条系统命令？",
};

const BUILTIN_TOOL_LABELS: Record<string, string> = {
  Bash: "运行终端命令",
  bash: "运行终端命令",
  PowerShell: "运行终端命令",
  pwsh: "运行终端命令",
  shell: "运行终端命令",
  Read: "读取文件",
  read: "读取文件",
  Write: "写入文件",
  write: "写入文件",
  Edit: "修改文件",
  edit: "修改文件",
  str_replace_editor: "修改文件",
  NotebookEdit: "编辑笔记本",
  Grep: "搜索文件内容",
  grep: "搜索文件内容",
  Glob: "查找文件",
  glob: "查找文件",
  WebFetch: "读取网页内容",
  web_fetch: "读取网页内容",
  WebSearch: "联网搜索",
  web_search: "联网搜索",
  TodoWrite: "更新任务清单",
  TodoRead: "查看任务清单",
  Skill: "调用技能",
  Agent: "派发子智能体",
  AskUserQuestion: "向你确认问题",
  EnterPlanMode: "进入计划模式",
  ExitPlanMode: "提交实现计划",
  TaskOutput: "读取后台任务结果",
  TaskStop: "停止后台任务",
  SendMessage: "发送子智能体消息",
  CronCreate: "创建定时任务",
  CronList: "查看定时任务",
  CronUpdate: "更新定时任务",
  CronDelete: "删除定时任务",
  OffPeakCreate: "创建闲时任务",
  OffPeakList: "查看闲时任务",
  CreateWorkflow: "运行自动化工作流",
  AmendWorkflow: "修订工作流",
  SaveWorkflow: "保存工作流",
  EvalWorkflowSnippet: "执行工作流片段",
  ListWorkflowRuns: "查看工作流记录",
  GetWorkflowRun: "查询工作流状态",
  ResumeWorkflowRun: "继续运行工作流",
  ResolveWorkflowQuestion: "回答工作流提问",
  FillWorkflowHole: "补全工作流步骤",
  ListSavedWorkflows: "查看已存工作流",
  SearchPlugins: "搜索插件",
  SuggestPluginInstall: "推荐安装插件",
  ListSessions: "查看会话列表",
  ReadSession: "读取会话记录",
  CreateSession: "创建协同会话",
  ForkSession: "建立分支会话",
  SendToSession: "向会话发送指令",
  WaitSessions: "等待会话完成",
  InterruptSession: "停止目标会话",
  RenameSession: "重命名会话",
  ListProjects: "查看项目列表",
  OpenSession: "切换会话",
  SetSessionArchived: "归档会话",
  SetSessionPinned: "置顶会话",
  ListModels: "查看可用模型",
  ReadTopicResource: "读取会话附件",
  // 官方文档四件套与内置插件 MCP 工具名
  docx_create: "生成 Word 文档",
  create_docx: "生成 Word 文档",
  docx_inspect: "解析 Word 文档",
  inspect_docx: "解析 Word 文档",
  xlsx_create: "生成 Excel 表格",
  create_xlsx: "生成 Excel 表格",
  xlsx_analyze: "分析表格数据",
  analyze_xlsx: "分析表格数据",
  pptx_create: "生成 PPT 演示文稿",
  create_pptx: "生成 PPT 演示文稿",
  pptx_inspect: "解析 PPT 演示大纲",
  inspect_pptx: "解析 PPT 演示大纲",
  pdf_create: "生成 PDF 文档",
  create_pdf: "生成 PDF 文档",
  pdf_inspect: "提取 PDF 文档内容",
  inspect_pdf: "提取 PDF 文档内容",
  chart_render: "生成可视化图表",
  render_chart: "生成可视化图表",
  design_palette: "生成界面设计方案",
  workspace_scan: "扫描项目结构",
  weather_get: "查询城市天气",
  hello: "插件问候测试",
};

const SERVER_LABELS: Record<string, string> = {
  nibigo_documents: "Word 文档",
  documents: "Word 文档",
  nibigo_spreadsheets: "Excel 表格",
  spreadsheets: "Excel 表格",
  nibigo_presentations: "PPT 演示",
  presentations: "PPT 演示",
  nibigo_pdf: "PDF 工具箱",
  pdf: "PDF 工具箱",
  nibigo_visualize: "图表可视化",
  visualize: "图表可视化",
  nibigo_design: "界面设计",
  design: "界面设计",
  nibigo_toolkit: "项目体检",
  toolkit: "项目体检",
  nibigo_weather: "天气查询",
  market_hello: "市场插件",
};

/** 工具名 → 面向用户的中文名称（绝不原样露出 `mcp__phone__*`）。 */
export function friendlyToolName(rawName: string, detail?: string): string {
  if (!rawName) return "工具调用";
  const { server, tool, isPhone } = splitMcpToolName(rawName);
  const cleanTool = tool.replace(/^phone[._]/u, "");

  if (isPhone || ( !server && cleanTool in PHONE_TOOL_LABELS && rawName.startsWith("phone") )) {
    if (
      (cleanTool === "tap" || cleanTool === "click") &&
      detail &&
      (paramPrimitiveOf(detail, "long_press") === "true" || paramPrimitiveOf(detail, "long") === "true")
    ) {
      return "长按手机屏幕";
    }
    if ((cleanTool === "open" || cleanTool === "open_app") && detail) {
      if (paramStringOf(detail, "url")) return "在手机打开网页";
      if (paramStringOf(detail, "package") || paramStringOf(detail, "app")) return "打开手机应用";
    }
    return PHONE_TOOL_LABELS[cleanTool] ?? `手机操控 · ${cleanTool}`;
  }

  if (BUILTIN_TOOL_LABELS[rawName]) return BUILTIN_TOOL_LABELS[rawName]!;
  if (BUILTIN_TOOL_LABELS[cleanTool]) return BUILTIN_TOOL_LABELS[cleanTool]!;

  if (server) {
    const serverLabel =
      SERVER_LABELS[server] ??
      server
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
  if (!rawName) return "允许执行这项操作？";
  const { tool, isPhone } = splitMcpToolName(rawName);
  const cleanTool = tool.replace(/^phone[._]/u, "");

  if (isPhone && PHONE_APPROVAL_TITLES[cleanTool]) {
    return PHONE_APPROVAL_TITLES[cleanTool]!;
  }
  if (PHONE_APPROVAL_TITLES[cleanTool] && rawName.startsWith("phone")) {
    return PHONE_APPROVAL_TITLES[cleanTool]!;
  }

  switch (cleanTool) {
    case "Bash":
    case "bash":
    case "PowerShell":
    case "pwsh":
    case "shell":
      return "允许运行这条终端命令？";
    case "Write":
    case "write":
      return "允许创建或写入这个文件？";
    case "Edit":
    case "edit":
    case "str_replace_editor":
      return "允许修改这个文件？";
    case "Read":
    case "read":
      return "允许读取这个文件？";
    case "WebFetch":
    case "web_fetch":
      return "允许访问并读取这个网页？";
    case "WebSearch":
    case "web_search":
      return "允许进行联网搜索？";
    default: {
      const label = friendlyToolName(rawName);
      return `允许执行「${label}」？`;
    }
  }
}

const DIRECTION_LABELS: Record<string, string> = {
  up: "向上滑动",
  down: "向下滑动",
  left: "向左滑动",
  right: "向右滑动",
};

const PHONE_KEY_LABELS: Record<string, string> = {
  back: "返回键",
  home: "主屏幕键",
  recents: "最近任务键",
  notifications: "展开通知栏",
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
        return query ? `筛选：${cap(query, 28)}` : "已安装应用列表";
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
        return cursor ? "翻页读取屏幕内容" : "获取当前界面元素";
      }
      case "tap": {
        const index = paramPrimitiveOf(raw, "index");
        return index ? `界面元素 #${index}` : "";
      }
      case "type": {
        const text = paramStringOf(raw, "text");
        const index = paramPrimitiveOf(raw, "index");
        if (text) return `“${cap(squash(text), 28)}”`;
        return index ? `输入框 #${index}` : "";
      }
      case "scroll": {
        const dir = paramStringOf(raw, "direction");
        const index = paramPrimitiveOf(raw, "index");
        const dirLabel = dir ? (DIRECTION_LABELS[dir] ?? dir) : "滑动屏幕";
        return index ? `${dirLabel} · 区域 #${index}` : dirLabel;
      }
      case "key":
      case "press_key": {
        const keyName = paramStringOf(raw, "name") ?? paramStringOf(raw, "key");
        return keyName ? (PHONE_KEY_LABELS[keyName] ?? keyName) : "";
      }
      case "screenshot":
        return "当前手机画面";
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
      if (typeof todosCount === "number" && todosCount > 0) return `${todosCount} 项任务`;
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
