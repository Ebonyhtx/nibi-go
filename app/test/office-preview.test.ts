import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";

import { BUNDLED_PLUGINS } from "../src/plugins/samples";
import {
  base64ToBytes,
  isLikelyBinaryText,
  officeKindOf,
  renderOfficeBase64ToHtml,
  renderOfficeBytesToHtml,
  renderPdfBytes,
  renderXlsxBytes,
} from "../src/workspace/officePreview";

function runBundledMcpCall(
  pluginDir: string,
  toolName: string,
  args: Record<string, unknown>,
  workDir: string,
): Record<string, unknown> {
  const plugin = BUNDLED_PLUGINS.find((p) => p.dir === pluginDir);
  if (!plugin || !plugin.files["server.mjs"]) {
    throw new Error(`missing bundled MCP server: ${pluginDir}`);
  }
  const scriptPath = join(workDir, `${pluginDir}.server.mjs`);
  writeFileSync(scriptPath, plugin.files["server.mjs"], "utf8");

  const rpcPayload =
    [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    ].join("\n") + "\n";

  const proc = spawnSync(process.execPath, [scriptPath], {
    cwd: workDir,
    input: rpcPayload,
    encoding: "utf8",
    timeout: 15_000,
  });
  expect(proc.status).toBe(0);
  const lines = proc.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const reply = lines.map((line) => JSON.parse(line) as { id?: number; result?: Record<string, unknown>; error?: unknown }).find((m) => m.id === 2);
  expect(reply?.error).toBeUndefined();
  return reply?.result ?? {};
}

describe("officePreview：右侧面板 Office / PDF 预览与防乱码", () => {
  it("准确识别四件套扩展名与二进制文件", () => {
    expect(officeKindOf("季度总结.DOCX")).toBe("docx");
    expect(officeKindOf("财务报表.xlsx")).toBe("xlsx");
    expect(officeKindOf("路演方案.pptx")).toBe("pptx");
    expect(officeKindOf("合同.pdf")).toBe("pdf");
    expect(officeKindOf("notes.md")).toBeNull();

    expect(isLikelyBinaryText("PK\x03\x04\x14\x00\x00\x00")).toBe(true);
    expect(isLikelyBinaryText("%PDF-1.4\n1 0 obj")).toBe(true);
    expect(isLikelyBinaryText("abc\0def")).toBe(true);
    expect(isLikelyBinaryText("# 标题\n这是一段正常的中文 Markdown 文本。\n")).toBe(false);
    expect(isLikelyBinaryText('{"ok": true, "message": "测试"}')).toBe(false);
  });

  it("真实调用内置四件套 MCP 生成中文 docx/xlsx/pptx/pdf 并无乱码渲染 HTML", () => {
    const dir = mkdtempSync(join(tmpdir(), "nibi-office-preview-"));
    try {
      // 1) Word (.docx)
      const docxPath = join(dir, "季度报告.docx");
      runBundledMcpCall(
        "nibigo-documents",
        "docx_create",
        {
          file_path: docxPath,
          title: "2026 Q4 产品进展报告",
          subtitle: "NIBI-GO 移动端团队",
          sections: [
            {
              heading: "核心成果",
              paragraphs: ["完成了右侧工作区文档预览改造，彻底消除乱码。"],
              bullets: ["支持 Word 章节与表格", "支持 Excel 多工作表"],
              table: [
                ["模块", "状态"],
                ["Word 预览", "已通过"],
              ],
            },
          ],
        },
        dir,
      );
      const docxHtml = renderOfficeBase64ToHtml(
        "docx",
        "季度报告.docx",
        readFileSync(docxPath).toString("base64"),
        false,
      );
      expect(docxHtml).toContain("2026 Q4 产品进展报告");
      expect(docxHtml).toContain("NIBI-GO 移动端团队");
      expect(docxHtml).toContain("完成了右侧工作区文档预览改造");
      expect(docxHtml).toContain("<ul><li>支持 Word 章节与表格</li><li>支持 Excel 多工作表</li></ul>");
      expect(docxHtml).toContain("<th>模块</th><th>状态</th>");
      expect(docxHtml).not.toContain("PK\x03\x04");

      // 2) Excel (.xlsx)
      const xlsxPath = join(dir, "营收明细.xlsx");
      runBundledMcpCall(
        "nibigo-spreadsheets",
        "xlsx_create",
        {
          file_path: xlsxPath,
          sheet_name: "月度汇总",
          headers: ["月份", "营收(万)", "增长率"],
          rows: [
            ["10月", 120, "15%"],
            ["11月", 156, "30%"],
          ],
        },
        dir,
      );
      const xlsxHtml = renderOfficeBase64ToHtml(
        "xlsx",
        "营收明细.xlsx",
        readFileSync(xlsxPath).toString("base64"),
        true,
      );
      expect(xlsxHtml).toContain("月度汇总");
      expect(xlsxHtml).toContain("<th>月份</th><th>营收(万)</th><th>增长率</th>");
      expect(xlsxHtml).toContain("<td>11月</td><td>156</td><td>30%</td>");

      // 3) PowerPoint (.pptx)
      const pptxPath = join(dir, "产品路演.pptx");
      runBundledMcpCall(
        "nibigo-presentations",
        "pptx_create",
        {
          file_path: pptxPath,
          title: "NIBI-GO 架构演进",
          subtitle: "端侧 Rust 内核 + 原生交互",
          slides: [
            {
              title: "性能与体验",
              bullets: ["UI 线程物理弹簧侧栏", "Office 四件套离线预览"],
            },
          ],
        },
        dir,
      );
      const pptxHtml = renderOfficeBase64ToHtml(
        "pptx",
        "产品路演.pptx",
        readFileSync(pptxPath).toString("base64"),
        false,
      );
      expect(pptxHtml).toContain("SLIDE 1 / 2");
      expect(pptxHtml).toContain("SLIDE 2 / 2");
      expect(pptxHtml).toContain("NIBI-GO 架构演进");
      expect(pptxHtml).toContain("UI 线程物理弹簧侧栏");

      // 4) PDF (.pdf) 含多页分页 + 中文 UTF-16BE + pdf_inspect 复核
      const pdfPath = join(dir, "方案说明.pdf");
      const manyLines = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 条：移动端离线预览验证`);
      runBundledMcpCall(
        "nibigo-pdf",
        "pdf_create",
        {
          file_path: pdfPath,
          title: "中文 PDF 排版验证",
          lines: manyLines,
        },
        dir,
      );
      const pdfBytes = readFileSync(pdfPath);
      const pdfHtml = renderOfficeBytesToHtml("pdf", "方案说明.pdf", pdfBytes, false);
      expect(pdfHtml).toContain("中文 PDF 排版验证");
      expect(pdfHtml).toContain("第 1 条：移动端离线预览验证");
      expect(pdfHtml).toContain("第 40 条：移动端离线预览验证");
      expect(pdfHtml).toContain("PAGE 1");
      expect(pdfHtml).toContain("PAGE 2");
      expect(pdfHtml).not.toContain("%PDF-1.4");

      const inspectRes = runBundledMcpCall("nibigo-pdf", "pdf_inspect", { file_path: pdfPath }, dir);
      const structured = inspectRes.structuredContent as { text?: string; summary?: string };
      expect(structured.summary).toContain("共 2 页");
      expect(structured.text).toContain("中文 PDF 排版验证");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("兼容旧版 UTF-8 括号串 PDF 与 FlateDecode 压缩流 + TJ 数组 PDF", () => {
    // 1) 旧版插件生成的 UTF-8 直接写入 (...) Tj 的中文 PDF
    const legacyPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Length 64 >>\nstream\nBT\n(旧版中文标题) Tj\n0 -18 Td\n(第一行中文内容 \\(带括号\\)) Tj\nET\nendstream\nendobj\n%%EOF\n",
      "utf8",
    );
    const legacyHtml = renderPdfBytes("legacy.pdf", legacyPdf, false);
    expect(legacyHtml).toContain("旧版中文标题");
    expect(legacyHtml).toContain("第一行中文内容 (带括号)");

    // 2) FlateDecode 压缩流 + TJ 数组 + ToUnicode CMap
    const cmapRaw = strToU8(
      "begincmap\n2 beginbfchar\n<0001> <4F60>\n<0002> <597D>\nendbfchar\nendcmap\n",
    );
    const compressedCmap = zlibSync(cmapRaw);
    const pageRaw = strToU8("BT\n[<0001> -20 <0002>] TJ\n0 -18 Td\n[(Hello) -250 (World)] TJ\nET\n");
    const compressedPage = zlibSync(pageRaw);

    const head1 = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Filter /FlateDecode /Length " + compressedCmap.length + " >>\nstream\n", "ascii");
    const mid = Buffer.from("\nendstream\nendobj\n3 0 obj\n<< /Filter /FlateDecode /Length " + compressedPage.length + " >>\nstream\n", "ascii");
    const tail = Buffer.from("\nendstream\nendobj\n%%EOF\n", "ascii");
    const flatePdf = Buffer.concat([head1, Buffer.from(compressedCmap), mid, Buffer.from(compressedPage), tail]);

    const flateHtml = renderPdfBytes("compressed.pdf", flatePdf, true);
    expect(flateHtml).toContain("你好");
    expect(flateHtml).toContain("Hello World");
  });

  it("支持标准 Excel 的 sharedStrings、稀疏列定位与多表自然排序", () => {
    const zip = zipSync({
      "xl/workbook.xml": strToU8(
        '<workbook><sheets><sheet name="概览" sheetId="1"/><sheet name="明细" sheetId="2"/></sheets></workbook>',
      ),
      "xl/sharedStrings.xml": strToU8(
        "<sst><si><t>姓名</t></si><si><t>备注 &amp; 说明</t></si><si><t>张三</t></si></sst>",
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="b"><v>1</v></c><c r="C2"><v>42</v></c></row></sheetData></worksheet>',
      ),
      "xl/worksheets/sheet2.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>第二表</t></is></c></row></sheetData></worksheet>',
      ),
    });
    const html = renderXlsxBytes("multi.xlsx", zip, false);
    expect(html).toContain("Excel · 2 表");
    expect(html).toContain("<th>姓名</th><th></th><th>备注 &amp; 说明</th>");
    expect(html).toContain("<td>张三</td><td>TRUE</td><td>42</td>");
    expect(html).toContain("第二表");
  });

  it("base64ToBytes 准确往返二进制字节", () => {
    const sample = new Uint8Array([0, 1, 2, 127, 128, 254, 255, 80, 75, 3, 4]);
    const b64 = Buffer.from(sample).toString("base64");
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(sample));
  });
});
