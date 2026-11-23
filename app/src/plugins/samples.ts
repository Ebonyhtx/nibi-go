// NIBI-GO 随包内置官方插件套件：
//   1. Word 文档 (nibigo-documents)：.docx 文档生成与结构解析（纯 Node OOXML/ZIP 引擎，零外部依赖）
//   2. Excel 表格 (nibigo-spreadsheets)：.xlsx / .csv 工作簿生成与数值统计分析
//   3. PPT 演示 (nibigo-presentations)：16:9 .pptx 幻灯片生成与大纲提取
//   4. PDF 工具箱 (nibigo-pdf)：.pdf 文档排版生成与页数/文本解析
//   5. 图表与可视化 (nibigo-visualize)：响应式 SVG/HTML 数据图表与架构流程图
//   6. NIBI-GO 指南 (nibigo-guide)：App 使用手册与插件开发指南（技能 + 静态面板，无 MCP）
//
// 所有 MCP 服务器均运行在本机 Node 24 子进程（stdio JSON-RPC），并在消息流中渲染原生 NIBI-GO 工具卡片。

import { GUIDE_MANIFEST } from "./guidePlugin";

export interface BundledPlugin {
  /** 插件目录名（稳定，不随 manifest 的 id 改动）。 */
  dir: string;
  manifest: Record<string, unknown>;
  /** 相对插件根目录的文件；含 MCP 入口脚本。 */
  files: Record<string, string>;
}

/** 已退役的旧版示例/内置插件目录：升级启动时由 store.ts 自动清理。 */
export const RETIRED_SAMPLE_DIRS = [
  "nibigo-weather",
  "nibigo-quick",
  "nibigo-focus",
  "nibigo-assistant",
  "nibigo.weather",
  "nibigo.focus",
  "nibigo.usage",
] as const;

/** 纯 Node 最小 ZIP 打包与解包器（供 Word/Excel/PPT 三个 OOXML 插件共用）。 */
const NODE_ZIP_HELPER = `
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const crc = crc32(rawBuf);
    const compBuf = deflateRawSync(rawBuf, { level: 6 });

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compBuf.length, 18);
    local.writeUInt32LE(rawBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    localParts.push(local, compBuf);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compBuf.length, 20);
    central.writeUInt32LE(rawBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);

    offset += local.length + compBuf.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function readZipEntries(buf) {
  const out = new Map();
  let pos = 0;
  while (pos + 30 <= buf.length) {
    const sig = buf.readUInt32LE(pos);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(pos + 8);
    const compSize = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = buf.subarray(pos + 30, pos + 30 + nameLen).toString("utf8");
    const dataStart = pos + 30 + nameLen + extraLen;
    const compData = buf.subarray(dataStart, dataStart + compSize);
    try {
      const raw = method === 0 ? compData : method === 8 ? inflateRawSync(compData) : null;
      if (raw) out.set(name, raw);
    } catch {}
    pos = dataStart + compSize;
  }
  return out;
}

function escXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
`;

// ── 1. Word 文档 (nibigo-documents) ─────────────────────────────────────────

const DOCUMENTS_SERVER = `#!/usr/bin/env node
import { createInterface } from "node:readline";
${NODE_ZIP_HELPER}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n");

const TOOLS = [
  {
    name: "docx_create",
    description: "生成标准 Word (.docx) 文档，支持标题、副标题、多级章节、段落、项目符号列表与表格。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "输出 .docx 文件路径，例如 report.docx" },
        title: { type: "string", description: "文档主标题" },
        subtitle: { type: "string", description: "可选副标题或摘要" },
        sections: {
          type: "array",
          description: "章节数组",
          items: {
            type: "object",
            properties: {
              heading: { type: "string", description: "章节标题" },
              paragraphs: { type: "array", items: { type: "string" }, description: "正文段落列表" },
              bullets: { type: "array", items: { type: "string" }, description: "要点列表" },
              table: {
                type: "array",
                description: "二维表格数据（首行为表头）",
                items: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      },
      required: ["file_path", "title"]
    },
    _meta: {
      ui: { resourceUri: "nibi-go://plugin/nibigo-documents/tool-card" },
      nibiGo: { card: "docx-card" }
    }
  },
  {
    name: "docx_inspect",
    description: "解析现有 Word (.docx) 文档，提取章节大纲、段落正文与字数统计。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "要解析的 .docx 文件路径" }
      },
      required: ["file_path"]
    },
    _meta: {
      ui: { resourceUri: "nibi-go://plugin/nibigo-documents/tool-card" },
      nibiGo: { card: "docx-card" }
    }
  }
];

function createDocx(args) {
  const outPath = resolve(String(args?.file_path || "document.docx"));
  const title = String(args?.title || "未命名文档");
  const subtitle = args?.subtitle ? String(args.subtitle) : "";
  const sections = Array.isArray(args?.sections) ? args.sections : [];

  const bodyParts = [];
  let charCount = title.length + subtitle.length;

  bodyParts.push(
    '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="44"/></w:rPr><w:t>' +
      escXml(title) +
      "</w:t></w:r></w:p>"
  );
  if (subtitle) {
    bodyParts.push(
      '<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr><w:r><w:rPr><w:color w:val="5D6C84"/><w:sz w:val="24"/></w:rPr><w:t>' +
        escXml(subtitle) +
        "</w:t></w:r></w:p>"
    );
  }

  for (const sec of sections) {
    if (sec?.heading) {
      charCount += String(sec.heading).length;
      bodyParts.push(
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>' +
          escXml(sec.heading) +
          "</w:t></w:r></w:p>"
      );
    }
    if (Array.isArray(sec?.paragraphs)) {
      for (const p of sec.paragraphs) {
        const text = String(p ?? "");
        charCount += text.length;
        bodyParts.push(
          '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">' +
            escXml(text) +
            "</w:t></w:r></w:p>"
        );
      }
    }
    if (Array.isArray(sec?.bullets)) {
      for (const b of sec.bullets) {
        const text = String(b ?? "");
        charCount += text.length;
        bodyParts.push(
          '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">• ' +
            escXml(text) +
            "</w:t></w:r></w:p>"
        );
      }
    }
    if (Array.isArray(sec?.table) && sec.table.length > 0) {
      const rowsXml = sec.table.map((row, rIdx) => {
        const cells = (Array.isArray(row) ? row : [row]).map((cell) => {
          const text = String(cell ?? "");
          charCount += text.length;
          return (
            "<w:tc><w:tcPr><w:tcW w:w=\\"2400\\" w:type=\\"dxa\\"/></w:tcPr><w:p><w:r>" +
            (rIdx === 0 ? "<w:rPr><w:b/></w:rPr>" : "") +
            "<w:t>" + escXml(text) + "</w:t></w:r></w:p></w:tc>"
          );
        }).join("");
        return "<w:tr>" + cells + "</w:tr>";
      }).join("");
      bodyParts.push(
        '<w:tbl><w:tblPr><w:tblBorders>' +
          '<w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>' +
          '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>' +
          '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E5E5E5"/>' +
          "</w:tblBorders></w:tblPr>" + rowsXml + "</w:tbl>"
      );
    }
  }

  const docXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    bodyParts.join("") +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    "</w:body></w:document>";

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
    "</w:styles>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  const zipBuf = buildZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "word/_rels/document.xml.rels", data: docRels },
    { name: "word/styles.xml", data: stylesXml },
    { name: "word/document.xml", data: docXml }
  ]);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, zipBuf);

  return {
    fileName: basename(outPath),
    filePath: outPath,
    title,
    summary: sections.length + " 个章节 · " + charCount + " 字",
    badge: "DOCX · " + Math.max(1, Math.round(zipBuf.length / 1024)) + " KB"
  };
}

function inspectDocx(args) {
  const inPath = resolve(String(args?.file_path || ""));
  const buf = readFileSync(inPath);
  const entries = readZipEntries(buf);
  const docXml = entries.get("word/document.xml")?.toString("utf8") || "";
  const paragraphs = [];
  const pRegex = /<w:p[\\s>][\\s\\S]*?<\\/w:p>/g;
  let m;
  while ((m = pRegex.exec(docXml)) !== null) {
    const tMatches = [...m[0].matchAll(/<w:t[^>]*>([\\s\\S]*?)<\\/w:t>/g)];
    const text = tMatches.map((x) => x[1]).join("").trim();
    if (text) paragraphs.push(text);
  }
  const fullText = paragraphs.join("\\n");
  return {
    fileName: basename(inPath),
    filePath: inPath,
    title: paragraphs[0] || basename(inPath),
    summary: paragraphs.length + " 个段落 · " + fullText.length + " 字",
    badge: "已解析",
    text: fullText.slice(0, 4000)
  };
}

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.id === undefined) return;
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "nibigo-documents", version: "1.0.0" }
      }
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    try {
      const info = params?.name === "docx_create" ? createDocx(params?.arguments) : inspectDocx(params?.arguments);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: info.title + " (" + info.summary + ")\\n" + (info.text || info.filePath) }],
          structuredContent: info,
          _meta: { nibiGo: { card: "docx-card", server: "nibigo_documents" } }
        }
      });
    } catch (err) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(err?.message || err) } });
    }
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method: " + method } });
});
`;

const DOCUMENTS_MANIFEST: Record<string, unknown> = {
  schemaVersion: 1,
  id: "nibigo-documents",
  name: "Word 文档",
  version: "1.0.0",
  description: "创建、排版与解析标准 Word (.docx) 文档，支持多级标题、段落、列表与数据表格。",
  minApp: "0.1.0",
  accent: "brand",
  caps: ["view.v1", "slots.v1", "effects.v1", "mcp.v1"],
  runtime: {
    type: "mcp",
    serverName: "nibigo_documents",
    entry: "server.mjs",
    alwaysLoad: true,
    timeoutMs: 30_000,
  },
  skills: [
    {
      id: "docx-authoring",
      name: "Word 文档写作与排版",
      description: "生成结构清晰的 .docx 报告、方案与公文，或解析现有 Word 文件。",
      body: [
        "# Word 文档制作指南",
        "",
        "1. 创建 Word 文档时优先调用 `mcp__nibigo_documents__docx_create`，传入清晰的 `title`、`subtitle` 与分章节 `sections`（含 `heading`、`paragraphs`、`bullets`、`table`）。",
        "2. 读取或审阅现有 `.docx` 文件时调用 `mcp__nibigo_documents__docx_inspect` 提取段落与大纲。",
        "3. 生成完成后告知用户文件名与章节概览，方便在右侧工作区文件面板查看。",
      ].join("\n"),
    },
  ],
  contributes: {
    toolCards: [
      {
        id: "docx-card",
        title: "Word 文档",
        tool: "docx_create",
        view: {
          type: "card",
          title: "Word · {{data.tool.structured.fileName}}",
          children: [
            {
              type: "row",
              align: "between",
              children: [
                { type: "text", text: "{{data.tool.structured.title}}", style: "title" },
                { type: "badge", text: "{{data.tool.structured.badge}}", tone: "brand" },
              ],
            },
            {
              type: "text",
              text: "{{data.tool.structured.summary}}",
              style: "caption",
              tone: "sub",
            },
          ],
        },
      },
    ],
    "composer.actions": [
      {
        id: "create-docx",
        title: "写 Word",
        icon: "doc",
        token: { kind: "command", value: "nibigo-documents-docx" },
        skills: ["nibigo-documents:docx-authoring"],
        prompt: [
          "用户希望生成或处理一份 Word (.docx) 文档。",
          "请调用 `mcp__nibigo_documents__docx_create` 或 `docx_inspect` 完成任务，章节层次分明。",
          "$ARGUMENTS",
        ].join("\n"),
      },
    ],
  },
};

// ── 2. Excel 表格 (nibigo-spreadsheets) ─────────────────────────────────────

const SPREADSHEETS_SERVER = `#!/usr/bin/env node
import { createInterface } from "node:readline";
${NODE_ZIP_HELPER}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n");

const TOOLS = [
  {
    name: "xlsx_create",
    description: "生成标准 Excel (.xlsx) 工作簿或 CSV 表格，支持表头、数值/文本单元格与多行列数据。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "输出 .xlsx 文件路径，例如 data.xlsx" },
        sheet_name: { type: "string", description: "工作表名称，默认 Sheet1" },
        headers: { type: "array", items: { type: "string" }, description: "表头列名数组" },
        rows: {
          type: "array",
          description: "数据行数组",
          items: { type: "array", items: { type: ["string", "number"] } }
        }
      },
      required: ["file_path", "headers", "rows"]
    },
    _meta: {
      ui: { resourceUri: "nibi-go://plugin/nibigo-spreadsheets/tool-card" },
      nibiGo: { card: "xlsx-card" }
    }
  },
  {
    name: "xlsx_analyze",
    description: "读取并统计 Excel (.xlsx) 或 CSV 表格的行数、列结构与数值列汇总指标。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "要分析的 .xlsx 或 .csv 文件路径" }
      },
      required: ["file_path"]
    },
    _meta: {
      ui: { resourceUri: "nibi-go://plugin/nibigo-spreadsheets/tool-card" },
      nibiGo: { card: "xlsx-card" }
    }
  }
];

function colLetter(idx) {
  let s = "";
  let n = idx + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function createXlsx(args) {
  const outPath = resolve(String(args?.file_path || "table.xlsx"));
  const sheetName = String(args?.sheet_name || "Sheet1").slice(0, 31);
  const headers = Array.isArray(args?.headers) ? args.headers.map(String) : [];
  const rows = Array.isArray(args?.rows) ? args.rows : [];
  const allRows = [headers, ...rows];

  const rowXml = allRows.map((row, rIdx) => {
    const rNum = rIdx + 1;
    const cells = (Array.isArray(row) ? row : [row]).map((val, cIdx) => {
      const ref = colLetter(cIdx) + rNum;
      if (typeof val === "number" && Number.isFinite(val)) {
        return '<c r="' + ref + '"><v>' + val + "</v></c>";
      }
      const num = Number(val);
      if (rIdx > 0 && val !== "" && val !== null && Number.isFinite(num) && String(num) === String(val).trim()) {
        return '<c r="' + ref + '"><v>' + num + "</v></c>";
      }
      return '<c r="' + ref + '" t="inlineStr"><is><t>' + escXml(val ?? "") + "</t></is></c>";
    }).join("");
    return '<row r="' + rNum + '">' + cells + "</row>";
  }).join("");

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    "<sheetData>" + rowXml + "</sheetData></worksheet>";

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="' + escXml(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>';

  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    "</Relationships>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    "</Types>";

  const zipBuf = buildZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: wbRels },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml }
  ]);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, zipBuf);

  return {
    fileName: basename(outPath),
    filePath: outPath,
    sheetName,
    summary: headers.length + " 列 × " + rows.length + " 行数据",
    badge: "XLSX · " + Math.max(1, Math.round(zipBuf.length / 1024)) + " KB"
  };
}

function analyzeTable(args) {
  const inPath = resolve(String(args?.file_path || ""));
  const buf = readFileSync(inPath);
  let matrix = [];
  if (inPath.toLowerCase().endsWith(".csv")) {
    const lines = buf.toString("utf8").split(/\\r?\\n/).filter((l) => l.trim().length > 0);
    matrix = lines.map((l) => l.split(",").map((c) => c.trim()));
  } else {
    const entries = readZipEntries(buf);
    const sheetXml = entries.get("xl/worksheets/sheet1.xml")?.toString("utf8") || "";
    const rowMatches = [...sheetXml.matchAll(/<row[^>]*>([\\s\\S]*?)<\\/row>/g)];
    matrix = rowMatches.map((rm) => {
      const cells = [...rm[1].matchAll(/<(?:t|v)[^>]*>([\\s\\S]*?)<\\/(?:t|v)>/g)];
      return cells.map((c) => c[1].trim());
    });
  }
  const headers = matrix[0] || [];
  const dataRows = matrix.slice(1);
  return {
    fileName: basename(inPath),
    filePath: inPath,
    sheetName: "数据概览",
    summary: headers.length + " 列 × " + dataRows.length + " 行 · 表头：" + headers.slice(0, 6).join(", "),
    badge: "已统计"
  };
}

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.id === undefined) return;
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "nibigo-spreadsheets", version: "1.0.0" }
      }
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    try {
      const info = params?.name === "xlsx_create" ? createXlsx(params?.arguments) : analyzeTable(params?.arguments);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: info.fileName + " (" + info.summary + ")\\n" + info.filePath }],
          structuredContent: info,
          _meta: { nibiGo: { card: "xlsx-card", server: "nibigo_spreadsheets" } }
        }
      });
    } catch (err) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(err?.message || err) } });
    }
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method: " + method } });
});
`;

const SPREADSHEETS_MANIFEST: Record<string, unknown> = {
  schemaVersion: 1,
  id: "nibigo-spreadsheets",
  name: "Excel 表格",
  version: "1.0.0",
  description: "生成与分析标准 Excel (.xlsx) 工作簿及 CSV 数据表，自动校验行列结构与数值指标。",
  minApp: "0.1.0",
  accent: "ok",
  caps: ["view.v1", "slots.v1", "effects.v1", "mcp.v1"],
  runtime: {
    type: "mcp",
    serverName: "nibigo_spreadsheets",
    entry: "server.mjs",
    alwaysLoad: true,
    timeoutMs: 30_000,
  },
  skills: [
    {
      id: "spreadsheet-analysis",
      name: "Excel 表格建模与统计",
      description: "构建结构化 .xlsx 数据表或对现有表格做汇总统计。",
      body: [
        "# Excel 表格制作指南",
        "",
        "1. 创建 Excel 表格时调用 `mcp__nibigo_spreadsheets__xlsx_create`，提供规范的 `headers` 列名与二维 `rows` 数据（数字直接传 number 类型）。",
        "2. 读取或统计现有 `.xlsx`/`.csv` 文件时调用 `mcp__nibigo_spreadsheets__xlsx_analyze`。",
      ].join("\n"),
    },
  ],
  contributes: {
    toolCards: [
      {
        id: "xlsx-card",
        title: "Excel 表格",
        tool: "xlsx_create",
        view: {
          type: "card",
          title: "Excel · {{data.tool.structured.fileName}}",
          children: [
            {
              type: "row",
              align: "between",
              children: [
                { type: "text", text: "{{data.tool.structured.sheetName}}", style: "title" },
                { type: "badge", text: "{{data.tool.structured.badge}}", tone: "ok" },
              ],
            },
            {
              type: "text",
              text: "{{data.tool.structured.summary}}",
              style: "caption",
              tone: "sub",
            },
          ],
        },
      },
    ],
    "composer.actions": [
      {
        id: "create-xlsx",
        title: "做表格",
        icon: "doc",
        token: { kind: "command", value: "nibigo-spreadsheets-xlsx" },
        skills: ["nibigo-spreadsheets:spreadsheet-analysis"],
        prompt: [
          "用户希望生成或分析一份 Excel (.xlsx) 数据表。",
          "请调用 `mcp__nibigo_spreadsheets__xlsx_create` 或 `xlsx_analyze` 完成任务。",
          "$ARGUMENTS",
        ].join("\n"),
      },
    ],
  },
};

// ── 3. PPT 演示 (nibigo-presentations) ──────────────────────────────────────

const PRESENTATIONS_SERVER = `#!/usr/bin/env node
import { createInterface } from "node:readline";
${NODE_ZIP_HELPER}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n");

const TOOLS = [
  {
    name: "pptx_create",
    description: "生成 16:9 宽屏 PowerPoint (.pptx) 演示文稿，含封面页与多页结构化要点幻灯片。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "输出 .pptx 文件路径，例如 deck.pptx" },
        title: { type: "string", description: "演示文稿主标题" },
        subtitle: { type: "string", description: "封面副标题" },
        slides: {
          type: "array",
          description: "幻灯片页面数组",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "单页标题" },
              bullets: { type: "array", items: { type: "string" }, description: "核心论点与要点列表" }
            },
            required: ["title"]
          }
        }
      },
      required: ["file_path", "title", "slides"]
    },
    _meta: {
      ui: { resourceUri: "nibi-go://plugin/nibigo-presentations/tool-card" },
      nibiGo: { card: "pptx-card" }
    }
  },
  {
    name: "pptx_inspect",
    description: "提取现有 PowerPoint (.pptx) 演示文稿的页数与每页标题/要点大纲。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "要解析的 .pptx 文件路径" }
      },
      required: ["file_path"]
    },
    _meta: {
      ui: { resourceUri: "nibi-go://plugin/nibigo-presentations/tool-card" },
      nibiGo: { card: "pptx-card" }
    }
  }
];

function slideXmlOf(slideTitle, bullets, isCover) {
  const paragraphs = (bullets || []).map((b) =>
    '<a:p><a:r><a:rPr lang="zh-CN" sz="' + (isCover ? "2000" : "1800") + '"/><a:t>' +
    (isCover ? "" : "• ") + escXml(b) + "</a:t></a:r></a:p>"
  ).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="685800" y="' + (isCover ? "2100000" : "548640") + '"/><a:ext cx="10820400" cy="1143000"/></a:xfrm></p:spPr>' +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="' + (isCover ? "4000" : "2800") + '" b="1"/><a:t>' +
    escXml(slideTitle) + "</a:t></a:r></a:p></p:txBody></p:sp>" +
    (paragraphs
      ? '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
        '<p:spPr><a:xfrm><a:off x="685800" y="' + (isCover ? "3400000" : "1828800") + '"/><a:ext cx="10820400" cy="4572000"/></a:xfrm></p:spPr>' +
        "<p:txBody><a:bodyPr/><a:lstStyle/>" + paragraphs + "</p:txBody></p:sp>"
      : "") +
    "</p:spTree></p:cSld></p:sld>"
  );
}

function createPptx(args) {
  const outPath = resolve(String(args?.file_path || "presentation.pptx"));
  const title = String(args?.title || "未命名演示");
  const subtitle = args?.subtitle ? String(args.subtitle) : "";
  const contentSlides = Array.isArray(args?.slides) ? args.slides : [];
  const allSlides = [
    { title, bullets: subtitle ? [subtitle] : [], isCover: true },
    ...contentSlides.map((s) => ({
      title: String(s?.title || "章节"),
      bullets: Array.isArray(s?.bullets) ? s.bullets.map(String) : [],
      isCover: false
    }))
  ];

  const entries = [];
  const sldIds = [];
  const presRels = [
    '<Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
  ];
  const ctOverrides = [
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
  ];

  allSlides.forEach((s, idx) => {
    const num = idx + 1;
    const rId = "rIdSlide" + num;
    sldIds.push('<p:sldId id="' + (255 + num) + '" r:id="' + rId + '"/>');
    presRels.push(
      '<Relationship Id="' + rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + num + '.xml"/>'
    );
    ctOverrides.push(
      '<Override PartName="/ppt/slides/slide' + num + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
    );
    entries.push({
      name: "ppt/slides/slide" + num + ".xml",
      data: slideXmlOf(s.title, s.bullets, s.isCover)
    });
    entries.push({
      name: "ppt/slides/_rels/slide" + num + ".xml.rels",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
        "</Relationships>"
    });
  });

  const presXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster1"/></p:sldMasterIdLst>' +
    "<p:sldIdLst>" + sldIds.join("") + "</p:sldIdLst>" +
    '<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';

  const masterXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>' +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';

  const layoutXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">' +
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>';

  const zipBuf = buildZip([
    {
      name: "[Content_Types].xml",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        ctOverrides.join("") + "</Types>"
    },
    {
      name: "_rels/.rels",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
        "</Relationships>"
    },
    { name: "ppt/presentation.xml", data: presXml },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        presRels.join("") + "</Relationships>"
    },
    { name: "ppt/slideMasters/slideMaster1.xml", data: masterXml },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
        "</Relationships>"
    },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: layoutXml },
    ...entries
  ]);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, zipBuf);

  return {
    fileName: basename(outPath),
    filePath: outPath,
    title,
    summary: "共 " + allSlides.length + " 页幻灯片（16:9 宽屏）",
    badge: "PPTX · " + Math.max(1, Math.round(zipBuf.length / 1024)) + " KB"
  };
}

function inspectPptx(args) {
  const inPath = resolve(String(args?.file_path || ""));
  const buf = readFileSync(inPath);
  const entries = readZipEntries(buf);
  const slides = [];
  for (const [name, data] of entries.entries()) {
    if (/^ppt\\/slides\\/slide\\d+\\.xml$/.test(name)) {
      const xml = data.toString("utf8");
      const texts = [...xml.matchAll(/<a:t>([\\s\\S]*?)<\\/a:t>/g)].map((m) => m[1].trim()).filter(Boolean);
      slides.push(texts.join(" | "));
    }
  }
  return {
    fileName: basename(inPath),
    filePath: inPath,
    title: slides[0]?.split("|")[0]?.trim() || basename(inPath),
    summary: "已解析 " + slides.length + " 页幻灯片大纲",
    badge: slides.length + " 页",
    outline: slides.join("\\n")
  };
}

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.id === undefined) return;
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "nibigo-presentations", version: "1.0.0" }
      }
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    try {
      const info = params?.name === "pptx_create" ? createPptx(params?.arguments) : inspectPptx(params?.arguments);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: info.title + " (" + info.summary + ")\\n" + (info.outline || info.filePath) }],
          structuredContent: info,
          _meta: { nibiGo: { card: "pptx-card", server: "nibigo_presentations" } }
        }
      });
    } catch (err) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(err?.message || err) } });
    }
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method: " + method } });
});
`;

const PRESENTATIONS_MANIFEST: Record<string, unknown> = {
  schemaVersion: 1,
  id: "nibigo-presentations",
  name: "PPT 演示",
  version: "1.0.0",
  description: "生成 16:9 宽屏 PowerPoint (.pptx) 演示文稿，或提取现有 PPT 的分页大纲。",
  minApp: "0.1.0",
  accent: "warn",
  caps: ["view.v1", "slots.v1", "effects.v1", "mcp.v1"],
  runtime: {
    type: "mcp",
    serverName: "nibigo_presentations",
    entry: "server.mjs",
    alwaysLoad: true,
    timeoutMs: 30_000,
  },
  skills: [
    {
      id: "presentation-design",
      name: "PPT 演示大纲与分页设计",
      description: "将主题拆解为每页 3-5 条核心论点的 16:9 演示文稿。",
      body: [
        "# PPT 演示文稿制作指南",
        "",
        "1. 创建 PPT 时调用 `mcp__nibigo_presentations__pptx_create`，每页 `title` 突出核心结论，`bullets` 控制在 3-5 条简明要点。",
        "2. 读取现有 `.pptx` 时调用 `mcp__nibigo_presentations__pptx_inspect` 获取每页大纲。",
      ].join("\n"),
    },
  ],
  contributes: {
    toolCards: [
      {
        id: "pptx-card",
        title: "PPT 演示",
        tool: "pptx_create",
        view: {
          type: "card",
          title: "PPT · {{data.tool.structured.fileName}}",
          children: [
            {
              type: "row",
              align: "between",
              children: [
                { type: "text", text: "{{data.tool.structured.title}}", style: "title" },
                { type: "badge", text: "{{data.tool.structured.badge}}", tone: "warn" },
              ],
            },
            {
              type: "text",
              text: "{{data.tool.structured.summary}}",
              style: "caption",
              tone: "sub",
            },
          ],
        },
      },
    ],
    "composer.actions": [
      {
        id: "create-pptx",
        title: "做 PPT",
        icon: "doc",
        token: { kind: "command", value: "nibigo-presentations-pptx" },
        skills: ["nibigo-presentations:presentation-design"],
        prompt: [
          "用户希望生成或梳理一份 PowerPoint (.pptx) 演示文稿。",
          "请调用 `mcp__nibigo_presentations__pptx_create` 或 `pptx_inspect` 完成任务。",
          "$ARGUMENTS",
        ].join("\n"),
      },
    ],
  },
};

// ── 4. PDF 工具箱 (nibigo-pdf) ──────────────────────────────────────────────

const PDF_SERVER = `#!/usr/bin/env node
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n");

const TOOLS = [
  {
    name: "pdf_create",
    description: "生成标准 PDF (.pdf) 文档，支持标题与多节正文排版。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "输出 .pdf 文件路径，例如 output.pdf" },
        title: { type: "string", description: "PDF 文档标题" },
        lines: { type: "array", items: { type: "string" }, description: "正文各行或段落列表" }
      },
      required: ["file_path", "title", "lines"]
    },
    _meta: {
      ui: { resourceUri: "nibi-go://plugin/nibigo-pdf/tool-card" },
      nibiGo: { card: "pdf-card" }
    }
  },
  {
    name: "pdf_inspect",
    description: "检查现有 PDF (.pdf) 文件的页数、体积与可提取文本。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "要解析的 .pdf 文件路径" }
      },
      required: ["file_path"]
    },
    _meta: {
      ui: { resourceUri: "nibi-go://plugin/nibigo-pdf/tool-card" },
      nibiGo: { card: "pdf-card" }
    }
  }
];

function toPdfUtf16Hex(str) {
  const text = String(str ?? "");
  let hex = "";
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return "<" + hex + ">";
}

function createPdf(args) {
  const outPath = resolve(String(args?.file_path || "document.pdf"));
  const title = String(args?.title || "PDF Document");
  const rawLines = Array.isArray(args?.lines) ? args.lines.map(String) : [];

  const pages = [];
  const firstCap = 34;
  const nextCap = 38;
  pages.push({ title, lines: rawLines.slice(0, firstCap) });
  for (let offset = firstCap; offset < rawLines.length; offset += nextCap) {
    pages.push({ title: null, lines: rawLines.slice(offset, offset + nextCap) });
  }

  const pageObjIds = pages.map((_, idx) => 5 + idx * 2);
  const objects = [
    "1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n",
    "2 0 obj\\n<< /Type /Pages /Kids [" + pageObjIds.map((id) => id + " 0 R").join(" ") + "] /Count " + pages.length + " >>\\nendobj\\n",
    "3 0 obj\\n<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UTF16-H /DescendantFonts [4 0 R] >>\\nendobj\\n",
    "4 0 obj\\n<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 /W [1 [500] 32 126 500] >>\\nendobj\\n"
  ];

  pages.forEach((page, idx) => {
    const pageId = 5 + idx * 2;
    const contentId = pageId + 1;
    const streamLines = ["BT"];
    if (page.title !== null) {
      streamLines.push("/F1 18 Tf", "54 770 Td", toPdfUtf16Hex(page.title) + " Tj", "/F1 11 Tf", "0 -28 Td");
    } else {
      streamLines.push("/F1 11 Tf", "54 776 Td");
    }
    for (const line of page.lines) {
      streamLines.push(toPdfUtf16Hex(line) + " Tj");
      streamLines.push("0 -18 Td");
    }
    streamLines.push("ET");
    const streamContent = streamLines.join("\\n");
    objects.push(
      pageId + " 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents " + contentId + " 0 R /Resources << /Font << /F1 3 0 R >> >> >>\\nendobj\\n"
    );
    objects.push(
      contentId + " 0 obj\\n<< /Length " + Buffer.byteLength(streamContent, "ascii") + " >>\\nstream\\n" + streamContent + "\\nendstream\\nendobj\\n"
    );
  });

  let pdf = "%PDF-1.4\\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf, "ascii");
  pdf += "xref\\n0 " + (objects.length + 1) + "\\n0000000000 65535 f \\n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \\n";
  }
  pdf += "trailer\\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\\nstartxref\\n" + xrefPos + "\\n%%EOF\\n";

  const buf = Buffer.from(pdf, "ascii");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);

  return {
    fileName: basename(outPath),
    filePath: outPath,
    title,
    summary: pages.length + " 页 · " + rawLines.length + " 行正文",
    badge: "PDF · " + Math.max(1, Math.round(buf.length / 1024)) + " KB"
  };
}

function decodeHexUtf16(hex) {
  const clean = hex.replace(/\\s+/g, "");
  const start = clean.startsWith("FEFF") || clean.startsWith("feff") ? 4 : 0;
  let out = "";
  for (let i = start; i + 3 < clean.length; i += 4) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
  }
  return out;
}

function inspectPdf(args) {
  const inPath = resolve(String(args?.file_path || ""));
  const buf = readFileSync(inPath);
  const raw = buf.toString("latin1");
  const pageMatches = raw.match(/\\/Type\\s*\\/Page\\b/g);
  const pageCount = pageMatches ? pageMatches.length : 1;
  const textMatches = [];
  for (const m of raw.matchAll(/<([0-9a-fA-F\\s]{4,})>\\s*Tj|\\(([^()]{1,400})\\)\\s*Tj/g)) {
    if (m[1]) {
      const s = decodeHexUtf16(m[1]).trim();
      if (s) textMatches.push(s);
    } else if (m[2]) {
      const s = Buffer.from(m[2], "latin1").toString("utf8").trim();
      if (s) textMatches.push(s);
    }
    if (textMatches.length >= 60) break;
  }
  return {
    fileName: basename(inPath),
    filePath: inPath,
    title: basename(inPath),
    summary: "共 " + pageCount + " 页 · " + Math.max(1, Math.round(buf.length / 1024)) + " KB",
    badge: pageCount + " 页",
    text: textMatches.join("\\n")
  };
}

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.id === undefined) return;
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "nibigo-pdf", version: "1.0.0" }
      }
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    try {
      const info = params?.name === "pdf_create" ? createPdf(params?.arguments) : inspectPdf(params?.arguments);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: info.fileName + " (" + info.summary + ")\\n" + (info.text || info.filePath) }],
          structuredContent: info,
          _meta: { nibiGo: { card: "pdf-card", server: "nibigo_pdf" } }
        }
      });
    } catch (err) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(err?.message || err) } });
    }
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method: " + method } });
});
`;

const PDF_MANIFEST: Record<string, unknown> = {
  schemaVersion: 1,
  id: "nibigo-pdf",
  name: "PDF 工具箱",
  version: "1.0.0",
  description: "生成标准 PDF (.pdf) 文档，或解析现有 PDF 文件的页数、体积与文本内容。",
  minApp: "0.1.0",
  accent: "brand",
  caps: ["view.v1", "slots.v1", "effects.v1", "mcp.v1"],
  runtime: {
    type: "mcp",
    serverName: "nibigo_pdf",
    entry: "server.mjs",
    alwaysLoad: true,
    timeoutMs: 30_000,
  },
  skills: [
    {
      id: "pdf-publishing",
      name: "PDF 文档生成与解析",
      description: "生成或提取 PDF 文档结构与文本。",
      body: [
        "# PDF 工具箱指南",
        "",
        "1. 生成 PDF 文件时调用 `mcp__nibigo_pdf__pdf_create`。",
        "2. 检查现有 `.pdf` 页数与文本时调用 `mcp__nibigo_pdf__pdf_inspect`。",
      ].join("\n"),
    },
  ],
  contributes: {
    toolCards: [
      {
        id: "pdf-card",
        title: "PDF 文档",
        tool: "pdf_create",
        view: {
          type: "card",
          title: "PDF · {{data.tool.structured.fileName}}",
          children: [
            {
              type: "row",
              align: "between",
              children: [
                { type: "text", text: "{{data.tool.structured.title}}", style: "title" },
                { type: "badge", text: "{{data.tool.structured.badge}}", tone: "brand" },
              ],
            },
            {
              type: "text",
              text: "{{data.tool.structured.summary}}",
              style: "caption",
              tone: "sub",
            },
          ],
        },
      },
    ],
    "composer.actions": [
      {
        id: "create-pdf",
        title: "转 PDF",
        icon: "doc",
        token: { kind: "command", value: "nibigo-pdf-pdf" },
        skills: ["nibigo-pdf:pdf-publishing"],
        prompt: [
          "用户希望生成或检查一份 PDF (.pdf) 文档。",
          "请调用 `mcp__nibigo_pdf__pdf_create` 或 `pdf_inspect` 完成任务。",
          "$ARGUMENTS",
        ].join("\n"),
      },
    ],
  },
};

// ── 5. 图表与可视化 (nibigo-visualize) ──────────────────────────────────────

const VISUALIZE_MANIFEST: Record<string, unknown> = {
  schemaVersion: 1,
  id: "nibigo-visualize",
  name: "图表与可视化",
  version: "1.0.0",
  description: "对齐 NIBI 客户端 visualize 插件：在对话中直接渲染 SVG 统计图表、架构图与交互式 HTML 看板。",
  minApp: "0.1.0",
  accent: "brand",
  caps: ["view.v1", "slots.v1", "effects.v1"],
  skills: [
    {
      id: "visual-storytelling",
      name: "移动端数据图表与架构可视化",
      description: "在回复中使用 ```svg 或 ```html 围栏输出高对比度、移动端自适应的可视化图表。",
      body: [
        "# 图表与可视化规范（纸上鸟配色）",
        "",
        "1. 当用户需要数据对比、趋势、占比或架构流程图时，直接在回复中使用 ` ```svg ` 或 ` ```html ` 代码围栏输出完整可渲染源码（NIBI-GO 消息流会自动将其渲染为可视化预览卡片）。",
        "2. 配色遵循纸上鸟暖色系：主色 `#C2662F`（品牌橙）、辅色 `#4A79B8`（钢青）、成功 `#2F7A52`、深墨 `#1C2F4E`、背景 `#FAF3E7`。",
        "3. SVG 必须带 `viewBox=\"0 0 640 ...\"` 与 `width=\"100%\"`，字号不小于 13px，确保在手机竖屏清晰可读。",
      ].join("\n"),
    },
  ],
  contributes: {
    "composer.actions": [
      {
        id: "make-chart",
        title: "画图表",
        icon: "sparkles",
        token: { kind: "command", value: "nibigo-visualize-chart" },
        skills: ["nibigo-visualize:visual-storytelling"],
        prompt: [
          "用户希望将数据或信息制作成可视化图表。",
          "请使用 ` ```svg ` 或 ` ```html ` 围栏输出一张布局精致、配色符合纸上鸟主题的可视化图表，并附简要解读。",
          "$ARGUMENTS",
        ].join("\n"),
      },
    ],
    "message.actions": [
      {
        id: "visualize-message",
        title: "转为可视化图表",
        command: "nibigo-visualize-from-message",
        skills: ["nibigo-visualize:visual-storytelling"],
        prompt: [
          "请把下面引用的消息内容（数据、步骤或架构关系）提炼并绘制成一张清晰的 ` ```svg ` 或 ` ```html ` 可视化图表：",
          "$ARGUMENTS",
        ].join("\n"),
      },
    ],
  },
};

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
  { dir: "nibigo-documents", manifest: DOCUMENTS_MANIFEST, files: { "server.mjs": DOCUMENTS_SERVER } },
  { dir: "nibigo-spreadsheets", manifest: SPREADSHEETS_MANIFEST, files: { "server.mjs": SPREADSHEETS_SERVER } },
  { dir: "nibigo-presentations", manifest: PRESENTATIONS_MANIFEST, files: { "server.mjs": PRESENTATIONS_SERVER } },
  { dir: "nibigo-pdf", manifest: PDF_MANIFEST, files: { "server.mjs": PDF_SERVER } },
  { dir: "nibigo-visualize", manifest: VISUALIZE_MANIFEST, files: {} },
  { dir: "nibigo-guide", manifest: GUIDE_MANIFEST, files: {} },
];

export const MANIFEST_FILE = "nibi-go.plugin.json";
