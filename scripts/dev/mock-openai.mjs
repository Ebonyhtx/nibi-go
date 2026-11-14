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

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 9099);
const MODEL = process.env.MOCK_OPENAI_MODEL ?? "mock-model";

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
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
    const text = replyText(body);
    const streaming = /"stream"\s*:\s*true/u.test(body);
    const id = "msg_mock";
    if (!streaming) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id,
          type: "message",
          role: "assistant",
          model: MODEL,
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 8, output_tokens: 16 },
        }),
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
    event("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    event("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    });
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
  const text = replyText(body);
  const streaming = /"stream"\s*:\s*true/u.test(body);

  if (!streaming) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: MODEL,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
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
