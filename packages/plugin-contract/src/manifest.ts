// 插件清单 `nibi-go.plugin.json` 的解析入口。
//
// 解析是“逐条隔离”的：顶层字段坏了整份 invalid；某一条 contribution 坏了只丢这一条。
// 所有问题都带 JSON Pointer 路径，设置页/插件中心可以照着显示“第几项有误”。

import { z } from "zod";

import { readEffects } from "./effects";
import { satisfiesMinApp } from "./version";
import { readView } from "./view";
import type {
  ContractIssue,
  ComposerActionContribution,
  ComposerTokenContribution,
  ComposerToolContribution,
  Effect,
  HostProfile,
  MessageActionContribution,
  PanelAction,
  ParsedPlugin,
  PluginManifest,
  PluginRuntime,
  PluginSkillContribution,
  SessionActionContribution,
  StripContribution,
  ToolCardContribution,
  PanelContribution,
  TurnNoteContribution,
  ViewText,
  ViewTone,
  WebIslandContribution,
} from "./types";
import { SLOT_LIMITS } from "./types";

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SERVER_RE = /^[a-z][a-z0-9_]{1,31}$/u;
const BINDING_RE = /^data(?:\.[A-Za-z0-9_-]+)*$/u;
const VERSION_RE = /^\d{1,6}(?:\.\d{1,6}){0,2}(?:[-+][0-9A-Za-z.-]{1,32})?$/u;
const TOKEN_VALUE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;

const manifestBasics = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(ID_RE, "id 只允许小写字母/数字/._-，且不超过 64 字符"),
  name: z.string().trim().min(1).max(64),
  version: z.string().regex(VERSION_RE, "version 必须是 1/1.2/1.2.3 形式"),
  description: z.string().trim().max(280).optional(),
  minApp: z.string().optional(),
  accent: z
    .enum(["default", "sub", "faint", "brand", "ok", "warn", "danger"])
    .optional(),
  caps: z.array(z.string().trim().min(1).max(32)).max(32).optional(),
  skills: z
    .array(
      z.object({
        id: z.string().regex(ID_RE),
        name: z.string().trim().min(1).max(64).optional(),
        description: z.string().trim().max(280).optional(),
        body: z.string().min(1).max(16 * 1024),
      }),
    )
    .max(8)
    .optional(),
  // `runtime` 交给 readRuntime 单独校验：坏掉的运行时不拒整份清单（其余槽还能显示）。
});

const dataSchema = z.record(z.string(), z.unknown());

function textValue(raw: unknown): ViewText | null {
  if (typeof raw === "string" && raw.length > 0 && raw.length <= 1_000) return raw;
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    typeof (raw as { $?: unknown }).$ === "string" &&
    BINDING_RE.test((raw as { $: string }).$)
  ) {
    return { $: (raw as { $: string }).$ };
  }
  return null;
}

function textLength(value: string): number {
  return [...value].length;
}

/** 短文本：字面量限长，数据绑定不限（运行时求值后再由 UI 截断）。 */
function shortTextValue(raw: unknown, maxChars: number): ViewText | null {
  const text = textValue(raw);
  if (text === null) return null;
  if (typeof text === "string" && textLength(text) > maxChars) return null;
  return text;
}

interface MenuAction {
  id: string;
  title: string;
  icon?: string;
  effects: Effect[];
}

/** 输入 token：`{ kind: "plugin" | "command" | "skill", value }`。 */
function readComposerToken(
  raw: unknown,
  path: string,
  issues: ContractIssue[],
): ComposerTokenContribution | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    issues.push({ path, message: "token 必须是对象" });
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const kind = value.kind;
  const token = typeof value.value === "string" ? value.value.trim() : "";
  if (
    (kind !== "plugin" && kind !== "command" && kind !== "skill") ||
    !TOKEN_VALUE_RE.test(token)
  ) {
    issues.push({
      path,
      message: "token 需要 kind=plugin|command|skill 与合法 value",
    });
    return undefined;
  }
  return { kind, value: token };
}

function readPrompt(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  return text.length > 0 && text.length <= 8_000 ? text : undefined;
}

function readSkillRefs(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const names = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => SKILL_NAME_RE.test(item))
    .slice(0, 8);
  return names.length > 0 ? names : undefined;
}

interface TokenAction {
  token?: ComposerTokenContribution;
  prompt?: string;
  skills?: string[];
  effects?: Effect[];
}

/** composer.actions / composer.tools 共用的 token/effects 解析：token 与 effects 至少有一个。 */
function readTokenAction(
  value: Record<string, unknown>,
  path: string,
  issues: ContractIssue[],
): TokenAction | null {
  const token = readComposerToken(value.token, `${path}/token`, issues);
  const effects =
    value.effects === undefined
      ? { effects: [] as Effect[], issues: [] as ContractIssue[] }
      : readEffects(value.effects, `${path}/effects`);
  issues.push(...effects.issues);
  if (!token && effects.effects.length === 0) {
    issues.push({
      path: `${path}/effects`,
      message: "action 需要 token 或至少一个合法效果",
    });
    return null;
  }
  const prompt = readPrompt(value.prompt);
  const skills = readSkillRefs(value.skills);
  // 命令 token 必须带正文：否则 /命令 发出去内核找不到命令，用户只会看到原始 token。
  if (token?.kind === "command" && !prompt) {
    issues.push({
      path: `${path}/prompt`,
      message: "command token 需要 prompt（内核展开用的命令正文）",
    });
    return null;
  }
  return {
    ...(token ? { token } : {}),
    ...(prompt ? { prompt } : {}),
    ...(skills ? { skills } : {}),
    ...(effects.effects.length > 0 ? { effects: effects.effects } : {}),
  };
}

/** message.actions / composer.tools / session.actions 共用的短动作解析。 */
function readMenuActions(
  raw: unknown,
  key: string,
  label: string,
  limit: number,
  maxTitle: number,
  issues: ContractIssue[],
  allowIcon: boolean,
): MenuAction[] {
  if (raw === undefined) return [];
  const path = `/contributes/${key}`;
  if (!Array.isArray(raw)) {
    issues.push({ path, message: `${key} 必须是数组` });
    return [];
  }
  if (raw.length > limit) {
    issues.push({
      path,
      message: `${key} 最多 ${limit} 个，已丢弃多出的 ${raw.length - limit} 个`,
    });
  }
  const actions: MenuAction[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.slice(0, limit).entries()) {
    const itemPath = `${path}/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ path: itemPath, message: `${label} 必须是对象` });
      continue;
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && ID_RE.test(value.id) ? value.id : "";
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!id || seen.has(id) || !title || textLength(title) > maxTitle) {
      issues.push({
        path: itemPath,
        message: `${label} 需要唯一 id 与 ≤${maxTitle} 字的 title`,
      });
      continue;
    }
    const effects = readEffects(value.effects, `${itemPath}/effects`);
    issues.push(...effects.issues);
    if (effects.effects.length === 0) {
      issues.push({ path: `${itemPath}/effects`, message: `${label} 至少需要一个合法效果` });
      continue;
    }
    const icon =
      allowIcon && typeof value.icon === "string" ? value.icon.slice(0, 32) : undefined;
    seen.add(id);
    actions.push({ id, title, ...(icon ? { icon } : {}), effects: effects.effects });
  }
  return actions;
}

function toneValue(raw: unknown): ViewTone | undefined {
  return raw === "default" || raw === "sub" || raw === "faint" || raw === "brand" || raw === "ok" || raw === "warn" || raw === "danger"
    ? raw
    : undefined;
}

function readActions(
  raw: unknown,
  path: string,
): { actions: PanelAction[]; issues: ContractIssue[] } {
  const issues: ContractIssue[] = [];
  const actions: PanelAction[] = [];
  if (raw === undefined) return { actions, issues };
  if (!Array.isArray(raw)) {
    issues.push({ path, message: "actions 必须是数组" });
    return { actions, issues };
  }
  for (const [index, item] of raw.slice(0, 8).entries()) {
    const itemPath = `${path}/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ path: itemPath, message: "action 必须是对象" });
      continue;
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && ID_RE.test(value.id) ? value.id : "";
    const label = typeof value.label === "string" ? value.label.trim() : "";
    if (!id || !label || textLength(label) > 12) {
      issues.push({ path: itemPath, message: "action 需要合法 id 与 ≤12 字的 label" });
      continue;
    }
    const effects = readEffects(value.effects, `${itemPath}/effects`);
    issues.push(...effects.issues);
    if (effects.effects.length === 0) {
      issues.push({ path: `${itemPath}/effects`, message: "action 至少需要一个合法效果" });
      continue;
    }
    actions.push({ id, label, effects: effects.effects });
  }
  if (raw.length > 8) {
    issues.push({ path, message: `actions 最多 8 个，已丢弃多出的 ${raw.length - 8} 个` });
  }
  return { actions, issues };
}

function readRuntime(raw: unknown): { runtime?: PluginRuntime; issues: ContractIssue[] } {
  if (raw === undefined) return { issues: [] };
  // 复用顶层 schema 的形状校验；这里只需要把 zod 的输出收窄成 PluginRuntime。
  const parsed = z
    .object({
      type: z.literal("mcp"),
      serverName: z.string().regex(SERVER_RE),
      entry: z.string().min(1).max(160),
      alwaysLoad: z.boolean().optional(),
      timeoutMs: z.number().int().positive().max(120_000).optional(),
    })
    .safeParse(raw);
  if (!parsed.success) {
    return {
      issues: [{ path: "/runtime", message: parsed.error.issues[0]?.message ?? "runtime 不合法" }],
    };
  }
  return { runtime: parsed.data as PluginRuntime, issues: [] };
}

function readToolCards(
  raw: unknown,
  issues: ContractIssue[],
  degraded: string[],
): ToolCardContribution[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ path: "/contributes/toolCards", message: "toolCards 必须是数组" });
    return [];
  }
  const cards: ToolCardContribution[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const path = `/contributes/toolCards/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ path, message: "toolCard 必须是对象" });
      continue;
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && ID_RE.test(value.id) ? value.id : "";
    if (!id || seen.has(id)) {
      issues.push({ path, message: "toolCard 需要唯一合法 id" });
      continue;
    }
    const view = readView(value.view, "toolCard");
    issues.push(...view.issues.map((issue) => ({ ...issue, path: `${path}/view${issue.path}` })));
    if (!view.view) continue;
    const actions = readActions(value.actions, `${path}/actions`);
    issues.push(...actions.issues);
    const tool =
      typeof value.tool === "string" && value.tool.trim().length > 0
        ? value.tool.trim().slice(0, 64)
        : undefined;
    const title =
      typeof value.title === "string" && value.title.trim().length > 0
        ? value.title.trim().slice(0, 24)
        : undefined;
    seen.add(id);
    if (view.degraded) degraded.push(`toolCards:${id}`);
    cards.push({
      id,
      ...(title ? { title } : {}),
      ...(tool ? { tool } : {}),
      view: view.view,
      actions: actions.actions,
    });
  }
  return cards;
}

function readComposerActions(
  raw: unknown,
  issues: ContractIssue[],
): ComposerActionContribution[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ path: "/contributes/composer.actions", message: "composer.actions 必须是数组" });
    return [];
  }
  const limit = SLOT_LIMITS["composer.actions"];
  if (raw.length > limit) {
    issues.push({
      path: "/contributes/composer.actions",
      message: `composer.actions 最多 ${limit} 个，已丢弃多出的 ${raw.length - limit} 个`,
    });
  }
  const actions: ComposerActionContribution[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.slice(0, limit).entries()) {
    const path = `/contributes/composer.actions/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ path, message: "composer action 必须是对象" });
      continue;
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && ID_RE.test(value.id) ? value.id : "";
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!id || seen.has(id) || !title || textLength(title) > 10) {
      issues.push({ path, message: "composer action 需要唯一 id 与 ≤10 字的 title" });
      continue;
    }
    const action = readTokenAction(value, path, issues);
    if (!action) continue;
    const icon = typeof value.icon === "string" ? value.icon.slice(0, 32) : undefined;
    seen.add(id);
    actions.push({ id, title, ...(icon ? { icon } : {}), ...action });
  }
  return actions;
}

function readComposerTools(
  raw: unknown,
  issues: ContractIssue[],
): ComposerToolContribution[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ path: "/contributes/composer.tools", message: "composer.tools 必须是数组" });
    return [];
  }
  const limit = SLOT_LIMITS["composer.tools"];
  if (raw.length > limit) {
    issues.push({
      path: "/contributes/composer.tools",
      message: `composer.tools 最多 ${limit} 个，已丢弃多出的 ${raw.length - limit} 个`,
    });
  }
  const actions: ComposerToolContribution[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.slice(0, limit).entries()) {
    const path = `/contributes/composer.tools/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ path, message: "composer tool 必须是对象" });
      continue;
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && ID_RE.test(value.id) ? value.id : "";
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!id || seen.has(id) || !title || textLength(title) > 12) {
      issues.push({ path, message: "composer tool 需要唯一 id 与 ≤12 字的 title" });
      continue;
    }
    const action = readTokenAction(value, path, issues);
    if (!action) continue;
    const icon = typeof value.icon === "string" ? value.icon.slice(0, 32) : undefined;
    seen.add(id);
    actions.push({ id, title, ...(icon ? { icon } : {}), ...action });
  }
  return actions;
}

function readMessageActions(
  raw: unknown,
  issues: ContractIssue[],
): MessageActionContribution[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ path: "/contributes/message.actions", message: "message.actions 必须是数组" });
    return [];
  }
  const limit = SLOT_LIMITS["message.actions"];
  if (raw.length > limit) {
    issues.push({
      path: "/contributes/message.actions",
      message: `message.actions 最多 ${limit} 个，已丢弃多出的 ${raw.length - limit} 个`,
    });
  }
  const actions: MessageActionContribution[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.slice(0, limit).entries()) {
    const path = `/contributes/message.actions/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ path, message: "message action 必须是对象" });
      continue;
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && ID_RE.test(value.id) ? value.id : "";
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!id || seen.has(id) || !title || textLength(title) > 12) {
      issues.push({ path, message: "message action 需要唯一 id 与 ≤12 字的 title" });
      continue;
    }
    const instruction = readPrompt(value.instruction);
    const effects =
      value.effects === undefined
        ? { effects: [] as Effect[], issues: [] as ContractIssue[] }
        : readEffects(value.effects, `${path}/effects`);
    issues.push(...effects.issues);
    if (!instruction && effects.effects.length === 0) {
      issues.push({
        path,
        message: "message action 需要 instruction 或至少一个合法效果",
      });
      continue;
    }
    seen.add(id);
    actions.push({
      id,
      title,
      ...(instruction ? { instruction } : {}),
      ...(effects.effects.length > 0 ? { effects: effects.effects } : {}),
    });
  }
  return actions;
}

function readPanels(raw: unknown, issues: ContractIssue[], degraded: string[]): PanelContribution[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ path: "/contributes/panels", message: "panels 必须是数组" });
    return [];
  }
  const limit = SLOT_LIMITS.panels;
  if (raw.length > limit) {
    issues.push({
      path: "/contributes/panels",
      message: `panels 最多 ${limit} 个，已丢弃多出的 ${raw.length - limit} 个`,
    });
  }
  const panels: PanelContribution[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.slice(0, limit).entries()) {
    const path = `/contributes/panels/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ path, message: "panel 必须是对象" });
      continue;
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && ID_RE.test(value.id) ? value.id : "";
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!id || seen.has(id) || !title || textLength(title) > 16) {
      issues.push({ path, message: "panel 需要唯一 id 与 ≤16 字的 title" });
      continue;
    }
    const view = readView(value.view, "panel");
    issues.push(...view.issues.map((issue) => ({ ...issue, path: `${path}/view${issue.path}` })));
    if (!view.view) continue;
    const actions = readActions(value.actions, `${path}/actions`);
    issues.push(...actions.issues);
    const data = value.data === undefined ? undefined : dataSchema.safeParse(value.data);
    if (data && !data.success) {
      issues.push({ path: `${path}/data`, message: "data 必须是对象" });
    }
    const description =
      typeof value.description === "string" && value.description.trim().length > 0
        ? value.description.trim().slice(0, 120)
        : undefined;
    const icon = typeof value.icon === "string" ? value.icon.slice(0, 32) : undefined;
    seen.add(id);
    if (view.degraded) degraded.push(`panels:${id}`);
    panels.push({
      id,
      title,
      ...(description ? { description } : {}),
      ...(icon ? { icon } : {}),
      ...(data?.success ? { data: data.data } : {}),
      view: view.view,
      actions: actions.actions,
    });
  }
  return panels;
}

function readStrips(raw: unknown, issues: ContractIssue[]): StripContribution[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ path: "/contributes/composer.strip", message: "composer.strip 必须是数组" });
    return [];
  }
  const limit = SLOT_LIMITS["composer.strip"];
  if (raw.length > limit) {
    issues.push({
      path: "/contributes/composer.strip",
      message: `composer.strip 最多 ${limit} 个，已丢弃多出的 ${raw.length - limit} 个`,
    });
  }
  const strips: StripContribution[] = [];
  for (const [index, item] of raw.slice(0, limit).entries()) {
    const path = `/contributes/composer.strip/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ path, message: "strip 必须是对象" });
      continue;
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && ID_RE.test(value.id) ? value.id : "";
    const text = shortTextValue(value.text, 120);
    if (!id || !text) {
      issues.push({ path, message: "strip 需要合法 id 与 ≤120 字的 text" });
      continue;
    }
    strips.push({ id, text, ...(toneValue(value.tone) ? { tone: toneValue(value.tone) } : {}) });
  }
  return strips;
}

function readTurnNotes(raw: unknown, issues: ContractIssue[]): TurnNoteContribution[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ path: "/contributes/turn.note", message: "turn.note 必须是数组" });
    return [];
  }
  const limit = SLOT_LIMITS["turn.note"];
  if (raw.length > limit) {
    issues.push({
      path: "/contributes/turn.note",
      message: `turn.note 最多 ${limit} 个，已丢弃多出的 ${raw.length - limit} 个`,
    });
  }
  const notes: TurnNoteContribution[] = [];
  for (const [index, item] of raw.slice(0, limit).entries()) {
    const path = `/contributes/turn.note/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ path, message: "turn.note 必须是对象" });
      continue;
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && ID_RE.test(value.id) ? value.id : "";
    const text = shortTextValue(value.text, 120);
    if (!id || !text) {
      issues.push({ path, message: "turn.note 需要合法 id 与 ≤120 字的 text" });
      continue;
    }
    notes.push({ id, text, ...(toneValue(value.tone) ? { tone: toneValue(value.tone) } : {}) });
  }
  return notes;
}

function readWebIslands(raw: unknown, issues: ContractIssue[]): WebIslandContribution[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ path: "/contributes/webIslands", message: "webIslands 必须是数组" });
    return [];
  }
  const limit = SLOT_LIMITS.webIslands;
  if (raw.length > limit) {
    issues.push({
      path: "/contributes/webIslands",
      message: `webIslands 最多 ${limit} 个，已丢弃多出的 ${raw.length - limit} 个`,
    });
  }
  const islands: WebIslandContribution[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.slice(0, limit).entries()) {
    const path = `/contributes/webIslands/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ path, message: "webIsland 必须是对象" });
      continue;
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && ID_RE.test(value.id) ? value.id : "";
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!id || seen.has(id) || !title || textLength(title) > 16) {
      issues.push({ path, message: "webIsland 需要唯一 id 与 ≤16 字的 title" });
      continue;
    }
    const html =
      typeof value.html === "string" && value.html.length > 0 && value.html.length <= 16 * 1024
        ? value.html
        : undefined;
    let url: string | undefined;
    if (typeof value.url === "string" && value.url.length > 0 && value.url.length <= 2_048) {
      try {
        const parsed = new URL(value.url);
        if (parsed.protocol === "https:" && parsed.username === "" && parsed.password === "") {
          url = value.url;
        }
      } catch {
        // 非法 URL 走下面的统一 issue。
      }
    }
    if ((html === undefined) === (url === undefined)) {
      issues.push({
        path,
        message: "webIsland 需要 url（https）或 html（≤16KiB）二选一",
      });
      continue;
    }
    seen.add(id);
    islands.push({ id, title, ...(html !== undefined ? { html } : { url }) });
  }
  return islands;
}

function emptyManifest(id: string, name: string, version: string): PluginManifest {
  return {
    schemaVersion: 1,
    id,
    name,
    version,
    caps: [],
    contributes: {
      toolCards: [],
      composerActions: [],
      messageActions: [],
      composerTools: [],
      sessionActions: [],
      panels: [],
      strips: [],
      turnNotes: [],
      webIslands: [],
    },
  };
}

/**
 * 解析一份清单。`input` 通常来自 `JSON.parse(nibi-go.plugin.json)`；任何形状都能喂。
 *
 * `fallbackId` 是顶层字段坏掉时给 UI 用的稳定 id（插件目录名）。
 */
export function readPluginManifest(
  input: unknown,
  profile: HostProfile,
  fallbackId = "invalid-plugin",
): ParsedPlugin {
  const issues: ContractIssue[] = [];
  const basics = manifestBasics.safeParse(input);
  if (!basics.success) {
    for (const issue of basics.error.issues) {
      issues.push({ path: `/${issue.path.join("/")}`, message: issue.message });
    }
    const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
    const id = typeof raw.id === "string" && ID_RE.test(raw.id) ? raw.id : fallbackId;
    const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim().slice(0, 64) : id;
    const version = typeof raw.version === "string" && raw.version.length > 0 ? raw.version.slice(0, 32) : "0.0.0";
    return {
      manifest: emptyManifest(id, name, version),
      status: "invalid",
      reason: "清单格式不合法",
      issues,
      slotsAvailable: false,
      degraded: [],
    };
  }
  const basicsValue = basics.data;
  const raw = input as Record<string, unknown>;
  const contributesRaw =
    typeof raw.contributes === "object" && raw.contributes !== null && !Array.isArray(raw.contributes)
      ? (raw.contributes as Record<string, unknown>)
      : {};

  const degraded: string[] = [];
  const runtime = readRuntime(raw.runtime);
  issues.push(...runtime.issues);
  const toolCards = readToolCards(contributesRaw.toolCards, issues, degraded);
  const composerActions = readComposerActions(contributesRaw["composer.actions"], issues);
  const messageActions = readMessageActions(contributesRaw["message.actions"], issues);
  const composerTools = readComposerTools(contributesRaw["composer.tools"], issues);
  const sessionActions: SessionActionContribution[] = readMenuActions(
    contributesRaw["session.actions"],
    "session.actions",
    "session action",
    SLOT_LIMITS["session.actions"],
    12,
    issues,
    false,
  );
  const panels = readPanels(contributesRaw.panels, issues, degraded);
  const strips = readStrips(contributesRaw["composer.strip"], issues);
  const turnNotes = readTurnNotes(contributesRaw["turn.note"], issues);
  const webIslands = readWebIslands(contributesRaw.webIslands, issues);

  const manifest: PluginManifest = {
    schemaVersion: 1,
    id: basicsValue.id,
    name: basicsValue.name,
    version: basicsValue.version,
    ...(basicsValue.description ? { description: basicsValue.description } : {}),
    ...(basicsValue.minApp ? { minApp: basicsValue.minApp } : {}),
    ...(basicsValue.accent ? { accent: basicsValue.accent } : {}),
    caps: basicsValue.caps ?? [],
    ...(basicsValue.skills && basicsValue.skills.length > 0
      ? { skills: basicsValue.skills as PluginSkillContribution[] }
      : {}),
    ...(runtime.runtime ? { runtime: runtime.runtime } : {}),
    contributes: {
      toolCards,
      composerActions,
      messageActions,
      composerTools,
      sessionActions,
      panels,
      strips,
      turnNotes,
      webIslands,
    },
  };

  // 版本下限：minApp 写坏了也按不可兼容处理（插件不能靠坏版本号绕过门）。
  const minApp = manifest.minApp;
  if (minApp !== undefined) {
    const parsedMin = VERSION_RE.test(minApp);
    if (!parsedMin) {
      return {
        manifest,
        status: "incompatible",
        reason: `minApp "${minApp}" 不是合法版本号`,
        issues,
        slotsAvailable: false,
        degraded,
      };
    }
    if (!satisfiesMinApp(profile.appVersion, minApp)) {
      return {
        manifest,
        status: "incompatible",
        reason: `需要 App ${minApp}，当前 ${profile.appVersion}`,
        issues,
        slotsAvailable: false,
        degraded,
      };
    }
  }

  // 远端主机没有插件槽（设计文档 §7 的降级边界）：插件仍可被发现，但不渲染任何槽。
  if (profile.host === "remote") {
    return {
      manifest,
      status: "ready",
      reason: "远端主机会话不渲染插件槽",
      issues,
      slotsAvailable: false,
      degraded,
    };
  }
  if (!profile.caps.includes("slots.v1")) {
    return {
      manifest,
      status: "ready",
      reason: "宿主没有 slots.v1 能力",
      issues,
      slotsAvailable: false,
      degraded,
    };
  }

  return { manifest, status: "ready", issues, slotsAvailable: true, degraded };
}