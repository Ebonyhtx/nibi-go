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
  name: "天气",
  version: "0.1.0",
  description: "问模型天气时，插件工具会返回结果，并在对话里显示一张天气卡。",
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
              text: "来自天气插件",
              style: "caption",
              tone: "faint",
              maxLines: 1,
            },
          ],
        },
      },
    ],
    "composer.actions": [
      {
        id: "ask-weather",
        title: "查天气",
        effects: [{ kind: "insert", text: "帮我查一下北京今天的天气。" }],
      },
    ],
  },
};

const QUICK_MANIFEST: Record<string, unknown> = {
  schemaVersion: 1,
  id: "nibigo.quick",
  name: "写作助手",
  version: "0.1.0",
  description: "长按助手消息可引用并润色/缩写；加号里有周报和邮件模板。",
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
        id: "polish-message",
        title: "润色",
        effects: [{ kind: "insert", text: "把这条消息润色得更清晰、专业，保持事实不变。" }],
      },
      {
        id: "shorten-message",
        title: "缩写",
        effects: [{ kind: "insert", text: "把这条消息缩写得更短，保留关键信息。" }],
      },
    ],
    "composer.tools": [
      {
        id: "weekly-template",
        title: "周报模板",
        icon: "doc",
        effects: [
          {
            kind: "insert",
            text: "请按「本周完成 / 关键结果 / 风险 / 下周计划」写一份周报。",
          },
        ],
      },
      {
        id: "mail-template",
        title: "邮件模板",
        icon: "globe",
        effects: [
          {
            kind: "insert",
            text: "帮我写一封简洁的邮件：主题清楚，正文三段（背景、诉求、下一步）。",
          },
        ],
      },
    ],
    "composer.strip": [
      { id: "writing-hint", text: "写作助手 · 长按消息可润色", tone: "faint" },
    ],
    panels: [
      {
        id: "checklist",
        title: "写作检查",
        description: "发送前检查清单；动作会让 NIBI 检查这段内容。",
        view: {
          type: "card",
          title: "发送前检查",
          children: [
            { type: "text", text: "快速过一遍这四项：", style: "body" },
            {
              type: "list",
              items: ["事实是否准确", "结构是否清楚", "语气是否合适", "长度是否合适"],
            },
          ],
        },
        actions: [
          {
            id: "check-writing",
            label: "让 NIBI 检查",
            effects: [
              {
                kind: "insert",
                text: "请按事实、结构、语气、长度检查上面的内容，并指出需要改的地方。",
              },
            ],
          },
        ],
      },
    ],
    "session.actions": [
      {
        id: "summarize-session",
        title: "总结本会话",
        effects: [{ kind: "insert", text: "请总结当前会话的要点、结论和待办。" }],
      },
    ],
    "turn.note": [{ id: "local-note", text: "本机处理 · 数据不出机", tone: "faint" }],
  },
};

const FOCUS_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>专注计时</title><style>body{margin:0;padding:24px;font-family:system-ui,-apple-system,sans-serif;background:#fdf7ec;color:#1c2f4e}main{max-width:520px;margin:0 auto}.eyebrow{font-size:11px;letter-spacing:.18em;color:#e08a3e;font-weight:700}h1{font-size:28px;margin:8px 0 18px}.ring{margin:0 auto 20px;width:220px;height:220px;border-radius:50%;background:#fffdf9;border:1px solid rgba(28,47,78,.12);display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(28,47,78,.08)}#time{font-size:48px;font-weight:700;letter-spacing:.04em}#status{margin-top:4px;font-size:12px;color:#6b788c}.row{display:flex;gap:10px;justify-content:center}.row button{border:0;border-radius:999px;padding:12px 22px;font-size:14px;font-weight:700;background:#e08a3e;color:#fff9ef}.row button.secondary{background:#f3ead8;color:#1c2f4e}.hint{margin-top:22px;font-size:12px;line-height:1.6;color:#6b788c}</style></head><body><main><div class="eyebrow">WEB ISLAND</div><h1>专注计时</h1><div class="ring"><div id="time">25:00</div><div id="status">准备开始</div></div><div class="row"><button id="start">开始</button><button id="reset" class="secondary">重置</button></div><p class="hint">这是一个可交互的网页面板：开始、暂停、重置都在插件页面里完成，宿主负责路由守卫与加载超时降级。</p></main><script>var total=25*60;var left=total;var timer=null;var timeEl=document.getElementById('time');var statusEl=document.getElementById('status');var startEl=document.getElementById('start');function render(){var m=Math.floor(left/60);var s=left%60;timeEl.textContent=(m<10?'0':'')+m+':'+(s<10?'0':'')+s;}function tick(){if(left<=0){clearInterval(timer);timer=null;statusEl.textContent='完成一次专注';startEl.textContent='开始';return;}left=left-1;render();}function toggle(){if(timer){clearInterval(timer);timer=null;startEl.textContent='继续';statusEl.textContent='已暂停';}else{if(left<=0){left=total;render();}timer=setInterval(tick,1000);startEl.textContent='暂停';statusEl.textContent='专注中';}}startEl.addEventListener('click',toggle);document.getElementById('reset').addEventListener('click',function(){clearInterval(timer);timer=null;left=total;render();statusEl.textContent='准备开始';startEl.textContent='开始';});render();</script></body></html>`;

const FOCUS_MANIFEST: Record<string, unknown> = {
  schemaVersion: 1,
  id: "nibigo.focus",
  name: "专注计时",
  version: "0.1.0",
  description: "Web Island 样例：一个可交互的 25 分钟专注计时器。",
  minApp: "0.1.0",
  caps: ["view.v1", "slots.v1", "effects.v1"],
  contributes: {
    "composer.actions": [
      {
        id: "focus-session",
        title: "专注",
        effects: [
          {
            kind: "insert",
            text: "帮我安排一个 25 分钟的专注时段，先做最重要的任务。",
          },
        ],
      },
    ],
    webIslands: [{ id: "timer", title: "专注计时器", html: FOCUS_HTML }],
  },
};

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
  { dir: "nibigo-weather", manifest: WEATHER_MANIFEST, files: { "server.mjs": WEATHER_SERVER } },
  { dir: "nibigo-quick", manifest: QUICK_MANIFEST, files: {} },
  { dir: "nibigo-focus", manifest: FOCUS_MANIFEST, files: {} },
];

export const MANIFEST_FILE = "nibi-go.plugin.json";
