// 内置插件（samples.ts）与内置精选社区插件的英文展示映射：
// 磁盘上的 manifest JSON 维持原有结构与中文默认值，不破坏单测或旧清单兼容；
// 在 en-US 模式下，插件中心、加号菜单、胶囊动作与消息长按菜单通过本表实时切换英文文案。

import { pickText } from "../i18n";

interface BuiltinPluginCopy {
  nameEn: string;
  descriptionEn?: string;
  actions?: Record<string, string>;
  skills?: Record<string, { nameEn: string; descriptionEn?: string }>;
}

const BUILTIN_COPY: Record<string, BuiltinPluginCopy> = {
  "nibigo-documents": {
    nameEn: "Word Documents",
    descriptionEn:
      "Create, format, and inspect standard Word (.docx) files with multi-level headings, paragraphs, lists, and tables.",
    actions: {
      "create-docx": "Write Word",
    },
    skills: {
      "docx-authoring": {
        nameEn: "Word Authoring & Layout",
        descriptionEn: "Draft structured .docx reports and docs, or inspect existing Word files.",
      },
    },
  },
  "nibigo-spreadsheets": {
    nameEn: "Excel Spreadsheets",
    descriptionEn:
      "Generate and analyze standard Excel (.xlsx) workbooks and CSV tables with automatic column and numeric checks.",
    actions: {
      "create-xlsx": "Create Sheet",
    },
    skills: {
      "spreadsheet-analysis": {
        nameEn: "Spreadsheet Modeling & Stats",
        descriptionEn: "Build structured .xlsx workbooks or summarize existing spreadsheets.",
      },
    },
  },
  "nibigo-presentations": {
    nameEn: "PowerPoint Slides",
    descriptionEn:
      "Build 16:9 widescreen PowerPoint (.pptx) decks or extract slide outlines from existing presentations.",
    actions: {
      "create-pptx": "Make Slides",
    },
    skills: {
      "presentation-design": {
        nameEn: "Slide Outline & Deck Design",
        descriptionEn: "Break topics into crisp 16:9 slides with 3–5 key points per slide.",
      },
    },
  },
  "nibigo-pdf": {
    nameEn: "PDF Toolkit",
    descriptionEn:
      "Generate standard PDF (.pdf) documents or inspect page count, size, and extractable text.",
    actions: {
      "create-pdf": "Export PDF",
    },
    skills: {
      "pdf-publishing": {
        nameEn: "PDF Authoring & Inspection",
        descriptionEn: "Create formatted PDF files or extract text and metadata.",
      },
    },
  },
  "nibigo-visualize": {
    nameEn: "Charts & Visuals",
    descriptionEn:
      "Render SVG charts, architecture diagrams, and interactive HTML dashboards directly inside chat.",
    actions: {
      "make-chart": "Draw Chart",
      "visualize-message": "Turn into visual chart",
    },
    skills: {
      "visual-storytelling": {
        nameEn: "Mobile Charts & Diagrams",
        descriptionEn:
          "Emit crisp, mobile-responsive SVG charts and interactive HTML visualizations in chat.",
      },
    },
  },
  "nibigo-guide": {
    nameEn: "NIBI-GO Guide",
    descriptionEn:
      "Built-in handbook and plugin development guide: app feature map, all 10 UI slots, MCP/skills/commands authoring, and publishing.",
    skills: {
      "nibi-go-usage": {
        nameEn: "NIBI-GO Usage & Feature Map",
        descriptionEn:
          "Use when the user asks how NIBI-GO works, where a feature lives, or reports input/notification/phone-control issues.",
      },
      "nibi-go-plugins": {
        nameEn: "GO Plugin System & UI Slots",
        descriptionEn:
          "Use when authoring plugins, choosing UI slots, or configuring ViewNode/effects/settings/runtime.",
      },
      "nibi-go-mcp-skills": {
        nameEn: "MCP, Skills & Commands",
        descriptionEn:
          "Use when adding MCP servers, writing skills or commands, or clarifying how the three load.",
      },
      "nibi-go-plugin-dev": {
        nameEn: "Building & Shipping GO Plugins",
        descriptionEn:
          "Use when developing a plugin from scratch, debugging via local ZIP, or preparing a market submission.",
      },
    },
  },
  "open.git-workflow": {
    nameEn: "Git Diff & Commit Review",
    descriptionEn:
      "Review workspace Git diffs, draft Conventional Commits messages, and spot merge risks.",
    actions: {
      "draft-commit": "Commit message",
    },
    skills: {
      "commit-review": {
        nameEn: "Git Commit Review",
        descriptionEn: "Review workspace diffs and draft Conventional Commits messages.",
      },
    },
  },
  "open.api-inspector": {
    nameEn: "HTTP API Inspector",
    descriptionEn:
      "Build REST/GraphQL requests, inspect response payloads, and diagnose integration errors.",
    actions: {
      "inspect-api": "Inspect API",
    },
    skills: {
      "api-debug": {
        nameEn: "API Integration Diagnostics",
        descriptionEn: "Verify HTTP headers, parameters, status codes, and response structures.",
      },
    },
  },
  "open.sql-helper": {
    nameEn: "SQL Modeling & Tuning",
    descriptionEn:
      "Design database schemas, craft complex aggregations, and optimize indexes & slow queries.",
    actions: {
      "optimize-sql": "Optimize SQL",
    },
    skills: {
      "sql-tuning": {
        nameEn: "SQL Modeling & Tuning",
        descriptionEn: "Database schema design and slow-query index optimization.",
      },
    },
  },
  "open.test-architect": {
    nameEn: "Unit Tests & Edge Cases",
    descriptionEn:
      "Derive happy-path, boundary, and error-branch unit tests for core functions to raise coverage.",
    actions: {
      "generate-tests": "Write tests",
    },
    skills: {
      "unit-testing": {
        nameEn: "Unit Test Generation",
        descriptionEn: "Generate happy-path and edge-case unit tests.",
      },
    },
  },
};

export function pluginDisplayName(pluginId: string, fallback: string): string {
  const entry = BUILTIN_COPY[pluginId];
  return entry ? pickText(fallback, entry.nameEn) : fallback;
}

export function pluginDisplayDescription(
  pluginId: string,
  fallback?: string,
): string | undefined {
  if (!fallback) return fallback;
  const entry = BUILTIN_COPY[pluginId];
  return entry?.descriptionEn ? pickText(fallback, entry.descriptionEn) : fallback;
}

export function pluginActionTitle(pluginId: string, actionId: string, fallback: string): string {
  const en = BUILTIN_COPY[pluginId]?.actions?.[actionId];
  return en ? pickText(fallback, en) : fallback;
}

export function pluginSkillName(
  pluginId: string | undefined,
  skillId: string,
  fallback: string,
): string {
  if (!pluginId) return fallback;
  const en = BUILTIN_COPY[pluginId]?.skills?.[skillId]?.nameEn;
  return en ? pickText(fallback, en) : fallback;
}

export function pluginSkillDescription(
  pluginId: string | undefined,
  skillId: string,
  fallback?: string,
): string | undefined {
  if (!fallback || !pluginId) return fallback;
  const en = BUILTIN_COPY[pluginId]?.skills?.[skillId]?.descriptionEn;
  return en ? pickText(fallback, en) : fallback;
}
