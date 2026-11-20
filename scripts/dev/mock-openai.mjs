#!/usr/bin/env node
// 开发期用的 OpenAI 兼容假服务（不参与产品路径）。
//
// 用途：在没有真实 Provider 凭据时，让手机上的内核跑通完整回合。
//   node scripts/dev/mock-openai.mjs            # 监听 127.0.0.1:9099
//   adb reverse tcp:9099 tcp:9099               # 手机的 127.0.0.1:9099 → 本机
//   内核 env：NIBI_MODEL_BASE_URL=http://127.0.0.1:9099/v1
//             NIBI_API_KEY=mock-key
//             NIBI_MODEL=mock-model
//
// 只实现 `POST /v1/chat/completions`（流式 SSE + 非流式 JSON）和 `GET /v1/models`。
//
// 审批卡/工具卡联调：提示里带 `TOOLTEST`（`MOCK_TOOL_TRIGGER` 可改）时回一次工具调用。
// 默认是 Bash；Android 上内核没有 bash/zsh，验审批请换成 Write：
//   MOCK_TOOL_NAME=Write \
//   MOCK_TOOL_INPUT='{"file_path":"/sdcard/Download/nibi-approval-test.txt","content":"nibi approval test"}' \
//   node scripts/dev/mock-openai.mjs

import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 9099);
const MODEL = process.env.MOCK_OPENAI_MODEL ?? "mock-model";

// 可选：把每个请求体 JSONL 追加到这个文件（验环境段/提示内容用；不设置就不落盘）。
const LOG_FILE = process.env.MOCK_OPENAI_LOG_FILE ?? "";

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function logBody(body) {
  if (!LOG_FILE) return;
  try {
    appendFileSync(LOG_FILE, `${JSON.stringify({ at: new Date().toISOString(), body })}\n`);
  } catch {
    // 日志落盘失败不影响联调。
  }
}

/** 开发期触发器：提示里带这个词就让假模型回一次 Bash 工具调用（用于验审批卡）。 */
const TOOL_TRIGGER = process.env.MOCK_TOOL_TRIGGER ?? "TOOLTEST";
const TOOL_NAME = process.env.MOCK_TOOL_NAME ?? "Bash";
const TOOL_COMMAND = process.env.MOCK_TOOL_COMMAND ?? "echo nibi-mock-tool-ok";
/** 工具入参：默认按 Bash 的 `{command}`；换别的工具用 MOCK_TOOL_INPUT 传 JSON。 */
const TOOL_INPUT = (() => {
  const raw = process.env.MOCK_TOOL_INPUT;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // 解析失败退回默认入参。
    }
  }
  return { command: TOOL_COMMAND };
})();

/** 最后一条 user 消息的文本（Anthropic/OpenAI 两种 content 形状都认）。 */
function lastUserText(body) {
  try {
    const parsed = JSON.parse(body);
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "user") continue;
      if (typeof message.content === "string") return message.content;
      if (Array.isArray(message.content)) {
        return message.content
          .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
          .join(" ");
      }
    }
  } catch {
    // 解析失败按无文本处理。
  }
  return "";
}

/** 工具调用 ID 必须每轮唯一：内核按 ID 落库，重复 ID 会被当成已处理/中断。 */
let toolCallSeq = 0;
function nextToolCallId() {
  toolCallSeq += 1;
  return `toolu_mock_${Date.now().toString(36)}_${toolCallSeq}`;
}

/** 当前这一轮是否已经带回了工具结果（只看最后一条消息，历史里的旧结果不算）。 */
function hasToolResult(body) {
  try {
    const parsed = JSON.parse(body);
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    const last = messages.at(-1);
    // OpenAI Chat Completions 的工具结果是一条 role:"tool" 消息。
    if (last?.role === "tool") return true;
    return (
      Array.isArray(last?.content) &&
      last.content.some((part) => part?.type === "tool_result")
    );
  } catch {
    return false;
  }
}

function replyText(body) {
  let prompt = "";
  try {
    const parsed = JSON.parse(body);
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    const last = messages.at(-1);
    if (typeof last?.content === "string") prompt = last.content;
    else if (Array.isArray(last?.content)) {
      prompt = last.content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join(" ");
    }
  } catch {
    // 解析失败就回固定文本。
  }
  return `（mock）收到：${prompt.slice(0, 120) || "空提示"}。我运行在手机的 libnibi.so 进程内。`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  console.log(`[mock-openai] ${request.method} ${url.pathname}`);

  if (request.method === "GET" && url.pathname.endsWith("/models")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
    return;
  }

  // Anthropic Messages 协议（内核在没指定 provider 协议时走这个：`/v1/messages`）。
  if (request.method === "POST" && url.pathname.endsWith("/messages")) {
    const body = await readBody(request);
    logBody(body);
    const text = replyText(body);
    const streaming = /"stream"\s*:\s*true/u.test(body);
    const id = "msg_mock";
    const toolTurn = lastUserText(body).includes(TOOL_TRIGGER) && !hasToolResult(body);
    try {
      const toolNames = JSON.parse(body)?.tools
        ?.map((tool) => tool?.name)
        .filter((name) => typeof name === "string" && name.length > 0);
      if (toolNames?.length) console.log(`[mock-openai] tools: ${toolNames.join(", ")}`);
    } catch {
      // 工具列表只用于开发期观察。
    }
    if (!streaming) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          toolTurn
            ? {
                id,
                type: "message",
                role: "assistant",
                model: MODEL,
                content: [
                  {
                    type: "tool_use",
                    id: nextToolCallId(),
                    name: TOOL_NAME,
                    input: TOOL_INPUT,
                  },
                ],
                stop_reason: "tool_use",
                stop_sequence: null,
                usage: { input_tokens: 8, output_tokens: 16 },
              }
            : {
                id,
                type: "message",
                role: "assistant",
                model: MODEL,
                content: [{ type: "text", text }],
                stop_reason: "end_turn",
                stop_sequence: null,
                usage: { input_tokens: 8, output_tokens: 16 },
              },
        ),
      );
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const event = (name, payload) =>
      response.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
    event("message_start", {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 8, output_tokens: 0 },
      },
    });
    // 按小块慢慢吐，模拟真实模型流式（默认 250ms 一块），便于观察增量渲染。
    const chunkMs = Number(process.env.MOCK_OPENAI_CHUNK_MS ?? 250);
    if (toolTurn) {
      // Anthropic 流式工具调用：先用 input_json_delta 把参数吐完，再以 tool_use 收尾。
      // 内核收到后执行 Bash → 默认权限模式会弹审批（用来验 GO 的审批卡）。
      event("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: nextToolCallId(), name: TOOL_NAME, input: {} },
      });
      event("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(TOOL_INPUT),
        },
      });
      if (chunkMs > 0) await new Promise((resolve) => setTimeout(resolve, chunkMs));
      event("content_block_stop", { type: "content_block_stop", index: 0 });
      event("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 16 },
      });
      event("message_stop", { type: "message_stop" });
      response.end();
      return;
    }
    event("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    const pieces = text.match(/[\s\S]{1,6}/gu) ?? [text];
    for (const piece of pieces) {
      event("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: piece },
      });
      if (chunkMs > 0) await new Promise((resolve) => setTimeout(resolve, chunkMs));
    }
    event("content_block_stop", { type: "content_block_stop", index: 0 });
    event("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 16 },
    });
    event("message_stop", { type: "message_stop" });
    response.end();
    return;
  }

  if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found", type: "invalid_request_error" } }));
    return;
  }

  const body = await readBody(request);
  logBody(body);
  const text = replyText(body);
  const streaming = /"stream"\s*:\s*true/u.test(body);
  const toolTurn = lastUserText(body).includes(TOOL_TRIGGER) && !hasToolResult(body);

  if (toolTurn) {
    try {
      const toolNames = JSON.parse(body)?.tools
        ?.map((tool) => tool?.function?.name ?? tool?.name)
        .filter((name) => typeof name === "string" && name.length > 0);
      if (toolNames?.length) console.log(`[mock-openai] tools: ${toolNames.join(", ")}`);
    } catch {
      // 工具列表只用于开发期观察。
    }
  }

  if (!streaming) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: MODEL,
        choices: [
          {
            index: 0,
            message: toolTurn
              ? {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: nextToolCallId(),
                      type: "function",
                      function: { name: TOOL_NAME, arguments: JSON.stringify(TOOL_INPUT) },
                    },
                  ],
                }
              : { role: "assistant", content: text },
            finish_reason: toolTurn ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 16, total_tokens: 24 },
      }),
    );
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  const id = "chatcmpl-mock";

  if (toolTurn) {
    const callId = nextToolCallId();
    send({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              { index: 0, id: callId, type: "function", function: { name: TOOL_NAME, arguments: "" } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    send({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: JSON.stringify(TOOL_INPUT) } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    send({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 8, completion_tokens: 16, total_tokens: 24 },
    });
    response.write("data: [DONE]\n\n");
    response.end();
    return;
  }

  send({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
  });
  send({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 8, completion_tokens: 16, total_tokens: 24 },
  });
  response.write("data: [DONE]\n\n");
  response.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-openai] listening on http://127.0.0.1:${PORT}/v1 (model=${MODEL})`);
});
