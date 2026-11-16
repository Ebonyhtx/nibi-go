// GO 内置样例插件（Phase 4）：工具卡、composer.actions、panels 各一个。
//
// 这些是**声明式插件**：清单 + 可选的 MCP 运行时代码都由 App 首次启动时写到
// `filesDir/plugins/<dir>/`。工具卡的温度来自真实 MCP 子进程（随包 Node），不是写死的 UI。
//
// 样例故意包含两处降级演示：
// - `nibigo.usage` 的 `tabs` 是 v2 组件，v1 宿主会摊平并标记“已降级”；
// - 远端主机会话没有插件槽（见 contract 的 host profile），插件中心如实显示原因。

export interface BundledPlugin {
  /** 插件目录名（稳定，不随 manifest 的 id 改动）。 */
  dir: string;
  manifest: Record<string, unknown>;
  /** 相对插件根目录的文件；目前只有 MCP 入口脚本。 */
  files: Record<string, string>;
}

/** 天气样例的 MCP stdio 服务器：一行一个 JSON-RPC，不写 stdout 日志。 */
const WEATHER_SERVER = `#!/usr/bin/env node
// NIBI-GO 样例插件：最小 MCP stdio 服务器（不依赖任何 npm 包）。
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");

const CITIES = {
  "北京": { summary: "晴", temperature: "24°C", advice: "样例数据：适合出门散步。" },
  "上海": { summary: "多云", temperature: "22°C", advice: "样例数据：带把伞更稳妥。" },
  "深圳": { summary: "阵雨", temperature: "28°C", advice: "样例数据：注意路面湿滑。" }
};

const TOOL = {
  name: "weather_get",
  description: "查询城市天气（NIBI-GO 样例插件）",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", description: "城市名，例如 北京" } },
    required: ["city"]
  },
  _meta: {
    ui: { resourceUri: "nibi-go://plugin/nibigo.weather/tool-card" },
    nibiGo: { card: "forecast" }
  }
};

function forecast(args) {
  const city = typeof args?.city === "string" && args.city.trim() ? args.city.trim() : "北京";
  return {
    city,
    ...(CITIES[city] ?? {
      summary: "多云",
      temperature: "22°C",
      advice: "样例数据：这个城市没有内置记录，返回默认值。"
    })
  };
}

rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!message || typeof message !== "object") return;
  const { id, method, params } = message;
  // 通知（没有 id）不需要回应。
  if (id === undefined) return;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "nibigo-weather", version: "0.1.0" }
      }
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: [TOOL] } });
    return;
  }
  if (method === "tools/call") {
    if (params?.name !== TOOL.name) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown tool: " + params?.name } });
      return;
    }
    const structured = forecast(params?.arguments);
    send({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: structured.city + " " + structured.summary + " " + structured.temperature }],
        structuredContent: structured,
        _meta: { nibiGo: { card: "forecast", server: "nibigo_weather" } }
      }
    });
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method: " + method } });
});

rl.on("close", () => process.exit(0));
`;

const WEATHER_MANIFEST: Record<string, unknown> = {
  schemaVersion: 1,
  id: "nibigo.weather",
  name: "天气（样例）",
  version: "0.1.0",
  description: "演示插件：MCP 工具 + 原生工具卡；数据来自插件子进程。",
  minApp: "0.1.0",
  caps: ["view.v1", "slots.v1", "effects.v1", "mcp.v1"],
  runtime: {
    type: "mcp",
    serverName: "nibigo_weather",
    entry: "server.mjs",
    alwaysLoad: true,
    timeoutMs: 20_000,
  },
  contributes: {
    toolCards: [
      {
        id: "forecast",
        title: "天气",
        tool: "weather_get",
        view: {
          type: "card",
          title: "天气 · {{data.tool.structured.city}}",
          children: [
            {
              type: "row",
              align: "between",
              children: [
                { type: "text", text: "{{data.tool.structured.summary}}", style: "title" },
                {
                  type: "badge",
                  text: "{{data.tool.structured.temperature}}",
                  tone: "brand",
                },
              ],
            },
            {
              type: "text",
              text: "{{data.tool.structured.advice}}",
              style: "caption",
              tone: "sub",
            },
            {
              type: "text",
              text: "来自插件工具 {{data.tool.name}}",
              style: "caption",
              tone: "faint",
              maxLines: 1,
            },
          ],
        },
      },
    ],
  },
};

const QUICK_MANIFEST: Record<string, unknown> = {
  schemaVersion: 1,
  id: "nibigo.quick",
  name: "快捷动作（样例）",
  version: "0.1.0",
  description: "演示插件：输入框上方的两个动作胶囊；只插入文字，不自动发送。",
  minApp: "0.1.0",
  caps: ["view.v1", "slots.v1", "effects.v1"],
  contributes: {
    "composer.actions": [
      {
        id: "summarize",
        title: "总结",
        effects: [{ kind: "insert", text: "请总结上面的内容，按要点列出。" }],
      },
      {
        id: "polish",
        title: "润色",
        effects: [{ kind: "insert", text: "把上面的内容润色一遍，保持事实不变。" }],
      },
    ],
    "message.actions": [
      {
        id: "explain",
        title: "解释",
        effects: [{ kind: "insert", text: "解释一下上面这条回答。" }],
      },
      {
        id: "shorten",
        title: "缩写",
        effects: [{ kind: "insert", text: "把上面这条回答缩写得更短。" }],
      },
    ],
    "composer.tools": [
      {
        id: "summary-template",
        title: "总结模板",
        icon: "sparkles",
        effects: [
          {
            kind: "insert",
            text: "请按以下结构总结：1) 结论 2) 依据 3) 风险 4) 下一步。",
          },
        ],
      },
      {
        id: "translate-template",
        title: "翻译模板",
        icon: "globe",
        effects: [
          {
            kind: "insert",
            text: "把下面的内容翻译成英文，保留代码与专有名词。",
          },
        ],
      },
    ],
    "composer.strip": [{ id: "quick-hint", text: "快捷动作可用", tone: "faint" }],
  },
};

const USAGE_MANIFEST: Record<string, unknown> = {
  schemaVersion: 1,
  id: "nibigo.usage",
  name: "运行状态（样例）",
  version: "0.1.0",
  description: "演示插件：面板 + 宿主数据绑定；tabs 在 v1 宿主下降级为纵向列。",
  minApp: "0.1.0",
  caps: ["view.v1", "slots.v1", "effects.v1"],
  contributes: {
    panels: [
      {
        id: "status",
        title: "本机状态",
        description: "宿主数据 + v2 组件降级演示",
        view: {
          type: "tabs",
          tabs: [
            {
              label: "概览",
              children: [
                {
                  type: "row",
                  align: "between",
                  children: [
                    { type: "text", text: "App 版本", style: "caption", tone: "sub" },
                    { type: "text", text: "{{data.host.appVersion}}", style: "mono" },
                  ],
                },
                {
                  type: "row",
                  align: "between",
                  children: [
                    { type: "text", text: "插件版本", style: "caption", tone: "sub" },
                    { type: "text", text: "{{data.host.pluginVersion}}", style: "mono" },
                  ],
                },
                {
                  type: "row",
                  align: "between",
                  children: [
                    { type: "text", text: "运行位置", style: "caption", tone: "sub" },
                    { type: "text", text: "{{data.host.host}}", style: "mono" },
                  ],
                },
                {
                  type: "row",
                  align: "between",
                  children: [
                    { type: "text", text: "已启用插件", style: "caption", tone: "sub" },
                    { type: "text", text: "{{data.host.enabledPlugins}}", style: "mono" },
                  ],
                },
                { type: "divider" },
                {
                  type: "list",
                  items: { $: "data.host.capabilities" },
                  empty: "没有能力声明",
                },
              ],
            },
            {
              label: "说明",
              children: [
                {
                  type: "text",
                  text: "这个面板来自插件清单，宿主只渲染声明式 JSON。",
                  style: "body",
                },
                {
                  type: "text",
                  text: "tabs 是 v2 组件；v1 宿主会摊平成纵向列，插件中心标记「已降级」。",
                  style: "caption",
                  tone: "faint",
                },
              ],
            },
          ],
        },
        actions: [{ id: "refresh", label: "刷新数据", effects: [{ kind: "refresh" }] }],
      },
    ],
    "turn.note": [{ id: "privacy", text: "本机运行 · 数据不出机", tone: "faint" }],
    "session.actions": [
      {
        id: "open-status",
        title: "本机状态",
        effects: [{ kind: "open", panel: "status" }],
      },
    ],
    webIslands: [
      {
        id: "welcome",
        title: "网页面板",
        html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>NIBI-GO</title><style>body{margin:0;padding:24px;font-family:system-ui,-apple-system,sans-serif;background:#fdf7ec;color:#1c2f4e}main{max-width:520px;margin:0 auto}.eyebrow{font-size:11px;letter-spacing:.18em;color:#e08a3e;font-weight:700}h1{font-size:28px;margin:8px 0 10px}p{font-size:14px;line-height:1.6;color:#4a5a72}.card{margin-top:18px;padding:16px;border:1px solid rgba(28,47,78,.12);border-radius:16px;background:#fffdf9;display:flex;flex-direction:column;gap:6px}span{font-size:12px;line-height:1.5;color:#6b788c}</style></head><body><main><div class="eyebrow">WEB ISLAND</div><h1>NIBI-GO</h1><p>这个面板来自插件清单里的 Web Island 声明，宿主用 WebView 渲染。</p><div class="card"><strong>路由守卫</strong><span>只允许当前页面与同源 https 导航；外部链接会被拦下。</span></div><div class="card"><strong>超时降级</strong><span>加载超时或失败时显示可重试的降级页，不会卡住会话。</span></div></main></body></html>`,
      },
      // 仅开发期：一个不可路由的 https 地址，用来验证 8s 超时/失败降级。
      ...(__DEV__
        ? [{ id: "timeout-demo", title: "超时演示", url: "https://10.255.255.1/" }]
        : []),
    ],
  },
};

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
  { dir: "nibigo-weather", manifest: WEATHER_MANIFEST, files: { "server.mjs": WEATHER_SERVER } },
  { dir: "nibigo-quick", manifest: QUICK_MANIFEST, files: {} },
  { dir: "nibigo-usage", manifest: USAGE_MANIFEST, files: {} },
];

export const MANIFEST_FILE = "nibi-go.plugin.json";
