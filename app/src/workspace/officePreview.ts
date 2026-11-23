// 工作区右侧面板（WorkspacePanel）的 Office 四件套（.docx / .xlsx / .pptx / .pdf）解析与预览渲染器。
//
// 为什么之前右侧面板打开生成的文档是乱码：
//   .docx / .xlsx / .pptx 本质是 OOXML ZIP 二进制压缩包（PK\x03\x04...），
//   .pdf 是二进制/压缩指令流（%PDF-1.4...）。
//   若直接用 readAsStringAsync(..., UTF8) 当成纯文本塞进 <Text>，会把底层二进制直接打印成乱码。
//
// 本模块保持纯 JS/TS（不直接依赖 expo-file-system，便于 Hermes 真机与 Node 单测同源运行）：
//   - 用 fflate 在内存中解包 OOXML / 解压 PDF FlateDecode 流；
//   - 解析 Word/Excel/PPT/PDF（含中文 UTF-8/UTF-16BE、ToUnicode CMap、TJ 数组、稀疏列）；
//   - 渲染为适配手机屏幕与深浅主题的排版 HTML，交由 WebView 呈现；
//   - 提供二进制内容探测，防止未知二进制文件落入文本视图时打印乱码。

import { inflateSync, strFromU8, unzipSync, unzlibSync } from "fflate";

import { pickText } from "../i18n";

export type OfficeDocKind = "docx" | "xlsx" | "pptx" | "pdf";

export const OFFICE_KIND_LABEL: Record<OfficeDocKind, string> = {
  docx: "Word",
  xlsx: "Excel",
  pptx: "PPT",
  pdf: "PDF",
};

export function officeKindOf(name: string): OfficeDocKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".pptx")) return "pptx";
  if (lower.endsWith(".pdf")) return "pdf";
  return null;
}

/** 纯 TS Base64 解码为字节数组（兼容 Hermes 与 Node，无全局 atob 差异）。 */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[\r\n\s]+/gu, "");
  if (clean.length === 0) return new Uint8Array(0);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) {
    lookup[alphabet.charCodeAt(i)] = i;
  }
  let pad = 0;
  if (clean.endsWith("==")) pad = 2;
  else if (clean.endsWith("=")) pad = 1;
  const outLen = Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean.charCodeAt(i);
    const c1 = clean.charCodeAt(i + 1);
    const c2 = clean.charCodeAt(i + 2);
    const c3 = clean.charCodeAt(i + 3);
    const v0 = c0 < 128 ? lookup[c0]! : -1;
    const v1 = c1 < 128 ? lookup[c1]! : -1;
    const v2 = c2 < 128 ? lookup[c2]! : -1;
    const v3 = c3 < 128 ? lookup[c3]! : -1;
    if (v0 < 0 || v1 < 0) continue;
    const triple = (v0 << 18) | (v1 << 12) | ((v2 >= 0 ? v2 : 0) << 6) | (v3 >= 0 ? v3 : 0);
    if (outIdx < outLen) out[outIdx++] = (triple >> 16) & 0xff;
    if (v2 >= 0 && outIdx < outLen) out[outIdx++] = (triple >> 8) & 0xff;
    if (v3 >= 0 && outIdx < outLen) out[outIdx++] = triple & 0xff;
  }
  return outIdx === outLen ? out : out.subarray(0, outIdx);
}

/** 探测按 UTF-8 读出的文本是否其实是二进制文件（防未知后缀落入纯文本时打印乱码）。 */
export function isLikelyBinaryText(raw: string): boolean {
  if (raw.length === 0) return false;
  // 常见二进制魔数（ZIP/OLE/PDF/ELF/SQLite/PNG）
  if (
    raw.startsWith("PK\x03\x04") ||
    raw.startsWith("%PDF-") ||
    raw.startsWith("\x7fELF") ||
    raw.startsWith("SQLite format 3\0") ||
    raw.startsWith("\uFFFD")
  ) {
    return true;
  }
  const sampleLen = Math.min(raw.length, 4096);
  let suspicious = 0;
  for (let i = 0; i < sampleLen; i++) {
    const code = raw.charCodeAt(i);
    if (code === 0) return true;
    if (code === 0xfffd || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) {
      suspicious++;
    }
  }
  return suspicious / sampleLen > 0.08;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/gu, (_, hex: string) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/gu, (_, dec: string) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

/** 字节数组按 Latin-1（1 字节 = 1 码点）转字符串，不依赖 Hermes 的 TextDecoder("latin1")。 */
function bytesToLatin1(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    const end = Math.min(i + step, bytes.length);
    let part = "";
    for (let j = i; j < end; j++) {
      part += String.fromCharCode(bytes[j]!);
    }
    chunks.push(part);
  }
  return chunks.join("");
}

/** 严格检查字节是否为合法 UTF-8（包含多字节校验），用于区分 UTF-8 与 Latin-1。 */
function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    if (b0 <= 0x7f) {
      i++;
      continue;
    }
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      if (i + 1 >= bytes.length) return false;
      const b1 = bytes[i + 1]!;
      if ((b1 & 0xc0) !== 0x80) return false;
      i += 2;
      continue;
    }
    if (b0 >= 0xe0 && b0 <= 0xef) {
      if (i + 2 >= bytes.length) return false;
      const b1 = bytes[i + 1]!;
      const b2 = bytes[i + 2]!;
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return false;
      if (b0 === 0xe0 && b1 < 0xa0) return false;
      if (b0 === 0xed && b1 >= 0xa0) return false;
      i += 3;
      continue;
    }
    if (b0 >= 0xf0 && b0 <= 0xf4) {
      if (i + 3 >= bytes.length) return false;
      const b1 = bytes[i + 1]!;
      const b2 = bytes[i + 2]!;
      const b3 = bytes[i + 3]!;
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return false;
      if (b0 === 0xf0 && b1 < 0x90) return false;
      if (b0 === 0xf4 && b1 >= 0x90) return false;
      i += 4;
      continue;
    }
    return false;
  }
  return true;
}

function decodeUtf16Be(bytes: Uint8Array, offset = 0): string {
  let out = "";
  for (let i = offset; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
  }
  return out;
}

function wrapPreviewHtml(title: string, badge: string, bodyHtml: string, isDark: boolean): string {
  const bg = isDark ? "#171614" : "#FAF7F2";
  const cardBg = isDark ? "#211F1C" : "#FFFFFF";
  const ink = isDark ? "#F3EFEA" : "#1F1C18";
  const sub = isDark ? "#A8A096" : "#6E665E";
  const border = isDark ? "rgba(255,255,255,0.1)" : "rgba(31,28,24,0.1)";
  const accent = "#D97736";
  const accentSoft = isDark ? "rgba(217,119,54,0.18)" : "rgba(217,119,54,0.12)";
  const thBg = isDark ? "#2A2723" : "#F3EDE4";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=3" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 12px;
    background: ${bg};
    color: ${ink};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "PingFang SC", sans-serif;
    font-size: 14px;
    line-height: 1.68;
    word-break: break-word;
  }
  .doc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid ${border};
  }
  .doc-title {
    font-size: 14px;
    font-weight: 700;
    color: ${ink};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .doc-badge {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    color: ${accent};
    background: ${accentSoft};
    padding: 2px 8px;
    border-radius: 999px;
  }
  .doc-card {
    background: ${cardBg};
    border: 1px solid ${border};
    border-radius: 12px;
    padding: 14px;
    margin-bottom: 12px;
  }
  .doc-hero-title {
    font-size: 19px;
    font-weight: 800;
    line-height: 1.35;
    margin: 0 0 6px;
    color: ${ink};
  }
  .doc-subtitle {
    font-size: 13px;
    color: ${sub};
    margin: 0 0 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid ${border};
  }
  h1 { font-size: 17px; font-weight: 700; margin: 16px 0 8px; line-height: 1.35; }
  h2 { font-size: 15.5px; font-weight: 700; margin: 14px 0 6px; line-height: 1.4; }
  h3 { font-size: 14.5px; font-weight: 700; margin: 12px 0 4px; line-height: 1.4; }
  p { margin: 0 0 9px; }
  ul { margin: 4px 0 10px; padding-left: 20px; }
  li { margin-bottom: 4px; }
  .table-wrap {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin: 10px 0;
    border-radius: 8px;
    border: 1px solid ${border};
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  th, td {
    padding: 7px 10px;
    border-bottom: 1px solid ${border};
    border-right: 1px solid ${border};
    text-align: left;
    vertical-align: top;
    white-space: pre-wrap;
    min-width: 56px;
  }
  th {
    background: ${thBg};
    font-weight: 700;
    white-space: nowrap;
  }
  tr:last-child td { border-bottom: none; }
  th:last-child, td:last-child { border-right: none; }
  .slide-card {
    background: ${cardBg};
    border: 1px solid ${border};
    border-radius: 12px;
    padding: 14px;
    margin-bottom: 12px;
  }
  .slide-num {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    color: ${accent};
    background: ${accentSoft};
    padding: 2px 8px;
    border-radius: 999px;
    margin-bottom: 8px;
  }
  .slide-title {
    font-size: 16px;
    font-weight: 700;
    margin: 0 0 8px;
    line-height: 1.4;
  }
  .empty-note {
    color: ${sub};
    font-size: 13px;
    text-align: center;
    padding: 20px 10px;
  }
  .foot-note {
    color: ${sub};
    font-size: 11.5px;
    margin-top: 8px;
  }
</style>
</head>
<body>
  <div class="doc-header">
    <div class="doc-title">${escapeHtml(title)}</div>
    <div class="doc-badge">${escapeHtml(badge)}</div>
  </div>
  ${bodyHtml}
</body>
</html>`;
}

/** 提取 Word 段落内的内联 HTML（保留加粗 run 与软换行）。 */
function extractDocxParagraphHtml(paraXml: string): { plain: string; html: string } {
  const runs = [...paraXml.matchAll(/<w:r\b[\s\S]*?<\/w:r>/gu)];
  if (runs.length === 0) {
    const texts = [...paraXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)].map((m) =>
      decodeXmlEntities(m[1]!),
    );
    const plain = texts.join("");
    return { plain, html: escapeHtml(plain) };
  }
  let plain = "";
  let html = "";
  for (const runMatch of runs) {
    const runXml = runMatch[0]!;
    const bold = /<w:b(?:\s+w:val="(?!0|false)[^"]*"|\s*\/)>/iu.test(runXml);
    const tokens = [...runXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/>|<w:tab\b[^>]*\/>/gu)];
    let runPlain = "";
    let runHtml = "";
    for (const tok of tokens) {
      if (tok[0]!.startsWith("<w:br")) {
        runPlain += "\n";
        runHtml += "<br/>";
      } else if (tok[0]!.startsWith("<w:tab")) {
        runPlain += "  ";
        runHtml += "&nbsp;&nbsp;";
      } else {
        const piece = decodeXmlEntities(tok[1] ?? "");
        runPlain += piece;
        runHtml += escapeHtml(piece);
      }
    }
    plain += runPlain;
    if (runHtml) {
      html += bold ? `<strong>${runHtml}</strong>` : runHtml;
    }
  }
  return { plain, html };
}

/** 解析 .docx (word/document.xml) → 标题、段落、列表与表格 HTML。 */
export function renderDocxBytes(name: string, bytes: Uint8Array, isDark: boolean): string {
  const entries = unzipSync(bytes);
  const docBytes = entries["word/document.xml"];
  if (!docBytes) {
    throw new Error(
      pickText(
        "未找到 word/document.xml，文件可能不是有效的 .docx 文档",
        "Missing word/document.xml; this file may not be a valid .docx document",
      ),
    );
  }
  const xml = strFromU8(docBytes);
  const bodyMatch = /<w:body[^>]*>([\s\S]*?)<\/w:body>/u.exec(xml);
  const bodyXml = bodyMatch ? bodyMatch[1]! : xml;

  const blocks: string[] = [];
  let pendingBullets: string[] = [];
  const flushBullets = () => {
    if (pendingBullets.length > 0) {
      blocks.push(`<ul>${pendingBullets.map((item) => `<li>${item}</li>`).join("")}</ul>`);
      pendingBullets = [];
    }
  };

  const tokenRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(bodyXml)) !== null) {
    const token = match[0]!;
    if (token.startsWith("<w:tbl")) {
      flushBullets();
      const rows = [...token.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gu)];
      if (rows.length === 0) continue;
      const trHtml = rows
        .map((rowMatch, rIdx) => {
          const cells = [...rowMatch[0]!.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gu)];
          const tag = rIdx === 0 ? "th" : "td";
          const cellsHtml = cells
            .map((cellMatch) => {
              const cellParas = [...cellMatch[0]!.matchAll(/<w:p\b[\s\S]*?<\/w:p>/gu)]
                .map((p) => extractDocxParagraphHtml(p[0]!).plain.trim())
                .filter((line) => line.length > 0);
              return `<${tag}>${cellParas.map(escapeHtml).join("<br/>")}</${tag}>`;
            })
            .join("");
          return `<tr>${cellsHtml}</tr>`;
        })
        .join("");
      blocks.push(`<div class="table-wrap"><table>${trHtml}</table></div>`);
    } else {
      const styleMatch = /<w:pStyle\s+w:val="([^"]+)"/u.exec(token);
      const style = styleMatch?.[1] ?? "";
      const hasNumPr = /<w:numPr\b/u.test(token);
      const { plain, html } = extractDocxParagraphHtml(token);
      const trimmed = plain.trim();
      if (!trimmed) continue;

      if (/^Title$/iu.test(style)) {
        flushBullets();
        blocks.push(`<div class="doc-hero-title">${escapeHtml(trimmed)}</div>`);
      } else if (/^Subtitle$/iu.test(style)) {
        flushBullets();
        blocks.push(`<div class="doc-subtitle">${escapeHtml(trimmed)}</div>`);
      } else if (/Heading1|^1$|^标题\s*1$/iu.test(style)) {
        flushBullets();
        blocks.push(`<h1>${escapeHtml(trimmed)}</h1>`);
      } else if (/Heading2|^2$|^标题\s*2$/iu.test(style)) {
        flushBullets();
        blocks.push(`<h2>${escapeHtml(trimmed)}</h2>`);
      } else if (/Heading[34]|^[34]$|^标题\s*[34]$/iu.test(style)) {
        flushBullets();
        blocks.push(`<h3>${escapeHtml(trimmed)}</h3>`);
      } else if (hasNumPr || /^[•·▪]\s+/u.test(trimmed)) {
        const cleanItem = trimmed.replace(/^[•·▪]\s+/u, "");
        pendingBullets.push(escapeHtml(cleanItem));
      } else {
        flushBullets();
        blocks.push(`<p>${html.trim() || escapeHtml(trimmed)}</p>`);
      }
    }
  }
  flushBullets();

  const content =
    blocks.length > 0
      ? `<div class="doc-card">${blocks.join("\n")}</div>`
      : `<div class="doc-card"><div class="empty-note">${pickText("文档内容为空", "Empty document")}</div></div>`;
  return wrapPreviewHtml(name, pickText("Word 文档", "Word Document"), content, isDark);
}

/** Excel 列字母（A=0, Z=25, AA=26）转 0 基列号。 */
function columnLettersToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

const MAX_XLSX_PREVIEW_ROWS = 400;

/** 解析 .xlsx (xl/sharedStrings.xml + xl/worksheets/sheet*.xml) → 表格 HTML。 */
export function renderXlsxBytes(name: string, bytes: Uint8Array, isDark: boolean): string {
  const entries = unzipSync(bytes);

  const sharedStrings: string[] = [];
  const sstBytes = entries["xl/sharedStrings.xml"];
  if (sstBytes) {
    const sstXml = strFromU8(sstBytes);
    for (const si of sstXml.matchAll(/<si\b[\s\S]*?<\/si>/gu)) {
      const parts = [...si[0]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)].map((m) =>
        decodeXmlEntities(m[1]!),
      );
      sharedStrings.push(parts.join(""));
    }
  }

  const sheetNames: string[] = [];
  const wbBytes = entries["xl/workbook.xml"];
  if (wbBytes) {
    const wbXml = strFromU8(wbBytes);
    for (const m of wbXml.matchAll(/<sheet\b[^>]*name="([^"]+)"/gu)) {
      sheetNames.push(decodeXmlEntities(m[1]!));
    }
  }

  const sheetKeys = Object.keys(entries)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/iu.test(k))
    .sort((a, b) => {
      const na = Number(/sheet(\d+)\.xml$/iu.exec(a)?.[1] ?? 0);
      const nb = Number(/sheet(\d+)\.xml$/iu.exec(b)?.[1] ?? 0);
      return na - nb;
    });

  if (sheetKeys.length === 0) {
    throw new Error(
      pickText(
        "未找到工作表数据（xl/worksheets/sheet1.xml）",
        "No worksheet data found (xl/worksheets/sheet1.xml)",
      ),
    );
  }

  const cards: string[] = [];
  sheetKeys.forEach((key, idx) => {
    const xml = strFromU8(entries[key]!);
    const rowMatches = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)];
    const truncated = rowMatches.length > MAX_XLSX_PREVIEW_ROWS;
    const slicedRows = rowMatches.slice(0, MAX_XLSX_PREVIEW_ROWS);

    const parsedRows: string[][] = [];
    let maxCols = 0;

    for (const rm of slicedRows) {
      const cells: string[] = [];
      let fallbackCol = 0;
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[1]!)) !== null) {
        const attrs = cm[1] ?? "";
        const inner = cm[2] ?? "";
        const refMatch = /\br="([A-Z]+)\d+"/iu.exec(attrs);
        const colIdx = refMatch ? columnLettersToIndex(refMatch[1]!.toUpperCase()) : fallbackCol;
        fallbackCol = colIdx + 1;

        const typeMatch = /\bt="([^"]+)"/u.exec(attrs);
        const cellType = typeMatch?.[1] ?? "n";
        let val = "";
        if (cellType === "inlineStr") {
          val = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)]
            .map((m) => decodeXmlEntities(m[1]!))
            .join("");
        } else {
          const vMatch = /<v[^>]*>([\s\S]*?)<\/v>/u.exec(inner);
          const rawV = vMatch ? decodeXmlEntities(vMatch[1]!.trim()) : "";
          if (cellType === "s") {
            const sIdx = Number(rawV);
            val =
              Number.isFinite(sIdx) && sharedStrings[sIdx] !== undefined
                ? sharedStrings[sIdx]!
                : rawV;
          } else if (cellType === "b") {
            val = rawV === "1" ? "TRUE" : rawV === "0" ? "FALSE" : rawV;
          } else {
            val = rawV;
          }
        }
        cells[colIdx] = val;
        if (colIdx + 1 > maxCols) maxCols = colIdx + 1;
      }
      if (cells.length > 0) parsedRows.push(cells);
    }

    const rowsHtml = parsedRows.map((row, rIdx) => {
      const tag = rIdx === 0 ? "th" : "td";
      const cellsHtml: string[] = [];
      for (let c = 0; c < maxCols; c++) {
        cellsHtml.push(`<${tag}>${escapeHtml(row[c] ?? "")}</${tag}>`);
      }
      return `<tr>${cellsHtml.join("")}</tr>`;
    });

    const title = sheetNames[idx] ?? `Sheet ${idx + 1}`;
    const body =
      rowsHtml.length > 0
        ? `<div class="table-wrap"><table>${rowsHtml.join("")}</table></div>${
            truncated
              ? `<div class="foot-note">${pickText(
                  `已预览前 ${MAX_XLSX_PREVIEW_ROWS} 行（共 ${rowMatches.length} 行）`,
                  `Showing first ${MAX_XLSX_PREVIEW_ROWS} of ${rowMatches.length} rows`,
                )}</div>`
              : ""
          }`
        : `<div class="empty-note">${pickText("空工作表", "Empty sheet")}</div>`;
    cards.push(`<div class="doc-card"><h3>${escapeHtml(title)}</h3>${body}</div>`);
  });

  return wrapPreviewHtml(
    name,
    pickText(
      `Excel · ${sheetKeys.length} 表`,
      `Excel · ${sheetKeys.length} ${sheetKeys.length === 1 ? "sheet" : "sheets"}`,
    ),
    cards.join("\n"),
    isDark,
  );
}

/** 解析 .pptx (ppt/slides/slide*.xml) → 幻灯片分镜卡片 HTML。 */
export function renderPptxBytes(name: string, bytes: Uint8Array, isDark: boolean): string {
  const entries = unzipSync(bytes);
  const slideKeys = Object.keys(entries)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/iu.test(k))
    .sort((a, b) => {
      const na = Number(/slide(\d+)\.xml$/iu.exec(a)?.[1] ?? 0);
      const nb = Number(/slide(\d+)\.xml$/iu.exec(b)?.[1] ?? 0);
      return na - nb;
    });

  if (slideKeys.length === 0) {
    throw new Error(
      pickText(
        "未找到幻灯片页面（ppt/slides/slide1.xml）",
        "No slides found (ppt/slides/slide1.xml)",
      ),
    );
  }

  const cards = slideKeys.map((key, idx) => {
    const xml = strFromU8(entries[key]!);
    const lines: string[] = [];
    for (const sp of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/gu)) {
      for (const p of sp[0]!.matchAll(/<a:p\b[\s\S]*?<\/a:p>/gu)) {
        const texts = [...p[0]!.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gu)].map((t) =>
          decodeXmlEntities(t[1]!),
        );
        const line = texts.join("").trim();
        if (line) lines.push(line);
      }
    }

    const tablesHtml: string[] = [];
    for (const tbl of xml.matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>/gu)) {
      const trs = [...tbl[0]!.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/gu)].map((tr, rIdx) => {
        const tag = rIdx === 0 ? "th" : "td";
        const tcs = [...tr[0]!.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/gu)]
          .map((tc) => {
            const texts = [...tc[0]!.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gu)].map((t) =>
              decodeXmlEntities(t[1]!),
            );
            return `<${tag}>${escapeHtml(texts.join(" ").trim())}</${tag}>`;
          })
          .join("");
        return `<tr>${tcs}</tr>`;
      });
      if (trs.length > 0) {
        tablesHtml.push(`<div class="table-wrap"><table>${trs.join("")}</table></div>`);
      }
    }

    const heading = lines[0] ?? pickText(`第 ${idx + 1} 页`, `Slide ${idx + 1}`);
    const bullets = lines.slice(1);
    const bulletsHtml =
      bullets.length > 0
        ? `<ul>${bullets
            .map((b) => `<li>${escapeHtml(b.replace(/^[•·\-*]\s*/u, ""))}</li>`)
            .join("")}</ul>`
        : tablesHtml.length > 0
          ? ""
          : `<p class="empty-note">${pickText("（本页无额外正文要点）", "(No additional text on this slide)")}</p>`;
    return `<div class="slide-card">
      <div class="slide-num">SLIDE ${idx + 1} / ${slideKeys.length}</div>
      <div class="slide-title">${escapeHtml(heading)}</div>
      ${bulletsHtml}
      ${tablesHtml.join("")}
    </div>`;
  });

  return wrapPreviewHtml(
    name,
    pickText(
      `PPT · ${slideKeys.length} 页`,
      `PPT · ${slideKeys.length} ${slideKeys.length === 1 ? "slide" : "slides"}`,
    ),
    cards.join("\n"),
    isDark,
  );
}

/** 解码 PDF 括号字面串 `(...)` 为原始字节数组（处理转义与八进制 `\ddd`）。 */
function decodePdfLiteralToBytes(rawLiteral: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < rawLiteral.length; i++) {
    const ch = rawLiteral[i]!;
    if (ch === "\\" && i + 1 < rawLiteral.length) {
      const next = rawLiteral[++i]!;
      if (next === "n") bytes.push(0x0a);
      else if (next === "r") bytes.push(0x0d);
      else if (next === "t") bytes.push(0x09);
      else if (next === "b") bytes.push(0x08);
      else if (next === "f") bytes.push(0x0c);
      else if (next === "(" || next === ")" || next === "\\") bytes.push(next.charCodeAt(0));
      else if (next === "\r") {
        if (rawLiteral[i + 1] === "\n") i++;
      } else if (next === "\n") {
        // 续行转义，忽略
      } else if (next >= "0" && next <= "7") {
        let oct = next;
        for (let k = 0; k < 2 && i + 1 < rawLiteral.length; k++) {
          const d = rawLiteral[i + 1]!;
          if (d >= "0" && d <= "7") {
            oct += d;
            i++;
          } else break;
        }
        bytes.push(parseInt(oct, 8) & 0xff);
      } else {
        bytes.push(next.charCodeAt(0) & 0xff);
      }
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/** 把 PDF 括号字面串原始字节按 UTF-16BE / 严格 UTF-8 / Latin-1 依次解码为可读文本。 */
function decodePdfLiteralString(rawLiteral: string): string {
  const bytes = decodePdfLiteralToBytes(rawLiteral);
  if (bytes.length === 0) return "";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes, 2);
  }
  if (isValidUtf8(bytes)) {
    return strFromU8(bytes);
  }
  return bytesToLatin1(bytes);
}

/** 从 PDF 的 ToUnicode CMap 流里提取 hex→Unicode 映射表（支持 bfchar 与 bfrange）。 */
function parseToUnicodeCMap(cmapText: string, map: Map<string, string>): void {
  for (const block of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/gu)) {
      const src = m[1]!.toUpperCase();
      const dstHex = m[2]!;
      const dstBytes = hexToBytes(dstHex);
      map.set(src, decodeUtf16Be(dstBytes));
    }
  }
  for (const block of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/gu)) {
      const start = parseInt(m[1]!, 16);
      const end = parseInt(m[2]!, 16);
      let dst = parseInt(m[3]!, 16);
      const padLen = m[1]!.length;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 512) continue;
      for (let code = start; code <= end; code++, dst++) {
        map.set(code.toString(16).toUpperCase().padStart(padLen, "0"), String.fromCodePoint(dst));
      }
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/gu, "");
  const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** 解码 PDF 十六进制字符串 `<...>`（支持 BOM UTF-16BE、ToUnicode CMap、UniGB-UTF16-H 与 UTF-8）。 */
function decodePdfHexString(hex: string, cmap: ReadonlyMap<string, string>): string {
  const clean = hex.replace(/\s+/gu, "").toUpperCase();
  if (clean.length === 0) return "";

  if (cmap.size > 0 && clean.length % 4 === 0) {
    let mapped = "";
    let hits = 0;
    const total = clean.length / 4;
    for (let i = 0; i < clean.length; i += 4) {
      const key = clean.slice(i, i + 4);
      const ch = cmap.get(key);
      if (ch !== undefined) {
        mapped += ch;
        hits++;
      } else {
        mapped += String.fromCharCode(parseInt(key, 16));
      }
    }
    if (hits > 0) return mapped;
  }

  const bytes = hexToBytes(clean);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes, 2);
  }

  // 检测无 BOM 的 UTF-16BE（例如 Type0 UniGB-UTF16-H：ASCII 为 00xx，汉字为 4Exx..9Fxx）
  if (bytes.length >= 2 && bytes.length % 2 === 0) {
    let plausibleUtf16 = 0;
    const units = bytes.length / 2;
    for (let i = 0; i < bytes.length; i += 2) {
      const code = (bytes[i]! << 8) | bytes[i + 1]!;
      if (
        (code >= 0x20 && code <= 0x7e) ||
        (code >= 0x3000 && code <= 0x9fff) ||
        (code >= 0xff00 && code <= 0xffef) ||
        (code >= 0x2000 && code <= 0x206f)
      ) {
        plausibleUtf16++;
      }
    }
    if (plausibleUtf16 / units >= 0.75) {
      return decodeUtf16Be(bytes);
    }
  }

  if (isValidUtf8(bytes)) {
    return strFromU8(bytes);
  }
  return bytesToLatin1(bytes);
}

/** 读取 PDF 文本流里的全部文本行（支持括号嵌套的 `(...) Tj`、`<hex> Tj` 与 `[...] TJ` 数组）。 */
function extractPdfContentLines(streamText: string, cmap: ReadonlyMap<string, string>): string[] {
  const lines: string[] = [];
  let currentLine = "";

  const flushLine = () => {
    const trimmed = currentLine.trim();
    if (trimmed.length > 0) lines.push(trimmed);
    currentLine = "";
  };

  let i = 0;
  const n = streamText.length;

  const readBalancedLiteral = (): string => {
    // streamText[i] === '('
    i++;
    let depth = 1;
    let buf = "";
    while (i < n && depth > 0) {
      const ch = streamText[i]!;
      if (ch === "\\" && i + 1 < n) {
        buf += ch + streamText[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      buf += ch;
      i++;
    }
    return buf;
  };

  const readHex = (): string => {
    // streamText[i] === '<'
    i++;
    let buf = "";
    while (i < n && streamText[i] !== ">") {
      buf += streamText[i]!;
      i++;
    }
    if (i < n && streamText[i] === ">") i++;
    return buf;
  };

  const skipWs = () => {
    while (i < n && /\s/u.test(streamText[i]!)) i++;
  };

  const readOperator = (): string => {
    skipWs();
    const start = i;
    while (i < n && !/[\s()<>[\]{}/%]/u.test(streamText[i]!)) i++;
    return streamText.slice(start, i);
  };

  while (i < n) {
    const ch = streamText[i]!;
    if (ch === "%") {
      while (i < n && streamText[i] !== "\n" && streamText[i] !== "\r") i++;
      continue;
    }
    if (ch === "(") {
      const lit = readBalancedLiteral();
      const op = readOperator();
      if (op === "Tj" || op === "'" || op === '"') {
        if (op === "'" || op === '"') flushLine();
        currentLine += decodePdfLiteralString(lit);
      }
      continue;
    }
    if (ch === "<" && streamText[i + 1] !== "<") {
      const hex = readHex();
      const op = readOperator();
      if (op === "Tj" || op === "'" || op === '"') {
        if (op === "'" || op === '"') flushLine();
        currentLine += decodePdfHexString(hex, cmap);
      }
      continue;
    }
    if (ch === "[") {
      i++;
      let chunk = "";
      while (i < n && streamText[i] !== "]") {
        skipWs();
        if (i >= n || streamText[i] === "]") break;
        const c = streamText[i]!;
        if (c === "(") {
          chunk += decodePdfLiteralString(readBalancedLiteral());
        } else if (c === "<" && streamText[i + 1] !== "<") {
          chunk += decodePdfHexString(readHex(), cmap);
        } else {
          const numStart = i;
          while (i < n && !/[\s()<>[\]]/u.test(streamText[i]!)) i++;
          const num = Number(streamText.slice(numStart, i));
          if (Number.isFinite(num) && num < -160 && chunk.length > 0 && !chunk.endsWith(" ")) {
            chunk += " ";
          }
        }
      }
      if (i < n && streamText[i] === "]") i++;
      const op = readOperator();
      if (op === "TJ") {
        currentLine += chunk;
      }
      continue;
    }
    if (
      (ch === "T" &&
        (streamText[i + 1] === "d" ||
          streamText[i + 1] === "D" ||
          streamText[i + 1] === "*" ||
          streamText[i + 1] === "m")) ||
      (ch === "E" && streamText[i + 1] === "T")
    ) {
      const prev = i > 0 ? streamText[i - 1]! : " ";
      const next = i + 2 < n ? streamText[i + 2]! : " ";
      if (/[\s\d\])>]/u.test(prev) && /[\s(\[<]/u.test(next)) {
        flushLine();
        i += 2;
        continue;
      }
    }
    i++;
  }
  flushLine();
  return lines;
}

/** 尝试解压 FlateDecode PDF 流（兼容 zlib 封装与裸 deflate）。 */
function decompressFlateStream(rawSlice: Uint8Array): Uint8Array | null {
  try {
    return unzlibSync(rawSlice);
  } catch {
    try {
      return inflateSync(rawSlice);
    } catch {
      return null;
    }
  }
}

/** 解析 .pdf 字节流 → 分页文本卡片 HTML（支持未压缩流与 FlateDecode 压缩流）。 */
export function renderPdfBytes(name: string, bytes: Uint8Array, isDark: boolean): string {
  const rawLatin1 = bytesToLatin1(bytes);
  const pageCount = Math.max(1, (rawLatin1.match(/\/Type\s*\/Page\b/gu) || []).length);

  // 1) 提取全部流及其前缀字典（保留字节索引以便准确解压 FlateDecode）
  const decodedStreams: Array<{ dict: string; text: string }> = [];
  const cmap = new Map<string, string>();
  const streamRe = /stream(?:\r\n|\n|\r)/gu;
  let sm: RegExpExecArray | null;

  while ((sm = streamRe.exec(rawLatin1)) !== null) {
    const dataStart = sm.index + sm[0]!.length;
    const endIdx = rawLatin1.indexOf("endstream", dataStart);
    if (endIdx < 0) break;

    let dataEnd = endIdx;
    while (dataEnd > dataStart && (bytes[dataEnd - 1] === 0x0a || bytes[dataEnd - 1] === 0x0d)) {
      dataEnd--;
    }

    const dictWindowStart = Math.max(0, sm.index - 512);
    const dict = rawLatin1.slice(dictWindowStart, sm.index);
    const isImage = /\/Subtype\s*\/Image\b/u.test(dict);
    const isEmbeddedFont = /\/Length1\b/u.test(dict);
    streamRe.lastIndex = endIdx + "endstream".length;

    if (isImage || isEmbeddedFont) continue;

    const rawSlice = bytes.subarray(dataStart, dataEnd);
    const isFlate = /\/FlateDecode\b/u.test(dict);
    let streamBytes: Uint8Array | null = rawSlice;
    if (isFlate) {
      streamBytes = decompressFlateStream(rawSlice);
      if (!streamBytes) continue;
    }

    const text = bytesToLatin1(streamBytes);
    if (text.includes("begincmap") || text.includes("beginbfchar") || text.includes("beginbfrange")) {
      parseToUnicodeCMap(text, cmap);
      continue;
    }
    if (text.includes("Tj") || text.includes("TJ") || text.includes("BT")) {
      decodedStreams.push({ dict, text });
    }
  }

  // 2) 从各页面内容流中按页提取文本行
  const pageCards: string[] = [];
  decodedStreams.forEach(({ text }, sIdx) => {
    const lines = extractPdfContentLines(text, cmap).filter((line) => {
      // 剔除明显乱码控制字符
      let printable = 0;
      for (let i = 0; i < line.length; i++) {
        const c = line.charCodeAt(i);
        if (c >= 0x20 && c !== 0x7f && c !== 0xfffd) printable++;
      }
      return line.length > 0 && printable / line.length >= 0.7;
    });
    if (lines.length > 0) {
      const paras = lines
        .map((line, lIdx) =>
          lIdx === 0 && sIdx === 0
            ? `<h1>${escapeHtml(line)}</h1>`
            : `<p>${escapeHtml(line)}</p>`,
        )
        .join("");
      pageCards.push(
        `<div class="slide-card"><div class="slide-num">PAGE ${pageCards.length + 1}</div>${paras}</div>`,
      );
    }
  });

  const totalPages = Math.max(pageCount, pageCards.length);
  const bodyHtml =
    pageCards.length > 0
      ? pageCards.join("\n")
      : `<div class="doc-card"><div class="empty-note">${pickText(
          `PDF 共 ${pageCount} 页（此文档为扫描件或纯图像页面，无直接可提取文本流）`,
          `PDF (${pageCount} ${pageCount === 1 ? "page" : "pages"}): scanned or image-only document with no extractable text stream`,
        )}</div></div>`;

  return wrapPreviewHtml(
    name,
    pickText(
      `PDF · ${totalPages} 页`,
      `PDF · ${totalPages} ${totalPages === 1 ? "page" : "pages"}`,
    ),
    bodyHtml,
    isDark,
  );
}

/** 从原始字节渲染 Office / PDF 文档为排版 HTML 字符串。 */
export function renderOfficeBytesToHtml(
  kind: OfficeDocKind,
  name: string,
  bytes: Uint8Array,
  isDark: boolean,
): string {
  switch (kind) {
    case "docx":
      return renderDocxBytes(name, bytes, isDark);
    case "xlsx":
      return renderXlsxBytes(name, bytes, isDark);
    case "pptx":
      return renderPptxBytes(name, bytes, isDark);
    case "pdf":
      return renderPdfBytes(name, bytes, isDark);
  }
}

/** 从 Base64 字节串渲染 Office / PDF 文档为排版 HTML 字符串。 */
export function renderOfficeBase64ToHtml(
  kind: OfficeDocKind,
  name: string,
  base64: string,
  isDark: boolean,
): string {
  return renderOfficeBytesToHtml(kind, name, base64ToBytes(base64), isDark);
}
