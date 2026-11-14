// 审批 / 提问卡片（对齐 dsh-Go ApprovalCard + QuestionCard）：
// 卡片里是光标（警示色细边 + 盾牌），正文给命令/路径，底部两键；
// 「本对话都允许」降级成文字按钮，避免误触。
//
// 数据来自内核 V4 快照的 `pendingInteractions`（行模型见 kernel-session rows.ts），
// 回答走 `v4/command` 的 `resolveInteraction`；答完内核把它从快照移除，卡片随下一帧消失。
import type { ChatRow } from "@nibi-go/kernel-session";
import { type ReactNode, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { radius, space, type as t, useNibiTheme } from "../theme";
import { Icon } from "./Icon";

export type ApprovalRow = Extract<ChatRow, { kind: "approval" }>;
export type QuestionRow = Extract<ChatRow, { kind: "question" }>;

export interface InteractionResponder {
  (interactionId: string, answer: Record<string, unknown>): Promise<void>;
}

function approvalTitle(toolName: string): string {
  switch (toolName) {
    case "bash":
    case "pwsh":
    case "shell":
      return "允许运行这条命令？";
    case "write":
      return "允许写入文件？";
    case "edit":
    case "str_replace_editor":
      return "允许修改文件？";
    case "web_fetch":
      return "允许访问这个网页？";
    case "web_search":
      return "允许联网搜索？";
    default:
      return toolName ? `允许使用 ${toolName}？` : "允许执行这个工具？";
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function CardShell({
  tone,
  icon,
  title,
  children,
}: {
  tone: "attention" | "ask";
  icon: "shield" | "question";
  title: string;
  children: ReactNode;
}) {
  const th = useNibiTheme();
  const accent = tone === "attention" ? th.amber : th.steel;
  const soft = tone === "attention" ? th.amberSoft : th.steelSoft;
  return (
    <View style={[styles.card, { backgroundColor: th.card, borderColor: th.hairline }]}>
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.cardBody}>
        <View style={styles.head}>
          <View style={[styles.iconWrap, { backgroundColor: soft }]}>
            <Icon name={icon} size={15} color={accent} />
          </View>
          <Text style={[styles.title, { color: th.ink }]}>{title}</Text>
        </View>
        {children}
      </View>
    </View>
  );
}

function ActionButton({
  label,
  kind,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  kind: "primary" | "secondary" | "text";
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const th = useNibiTheme();
  if (kind === "text") {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={styles.textButton}
      >
        <Text style={[styles.textButtonLabel, { color: disabled ? th.inkGhost : th.inkSub }]}>
          {busy ? "处理中…" : label}
        </Text>
      </Pressable>
    );
  }
  const primary = kind === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.action,
        primary
          ? { backgroundColor: disabled ? th.brandSoft : th.brand }
          : { borderColor: th.hairline, borderWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Text
        style={[
          styles.actionLabel,
          { color: primary ? (disabled ? th.inkFaint : th.brandFg) : th.inkSub },
        ]}
      >
        {busy ? "处理中…" : label}
      </Text>
    </Pressable>
  );
}

export function ApprovalCard({
  row,
  onRespond,
}: {
  row: ApprovalRow;
  onRespond: InteractionResponder;
}) {
  const th = useNibiTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { primary, secondary, allowAlways, extras } = useMemo(() => {
    const allowOnce = row.options.find((option) => option.kind === "allowOnce");
    const deny = row.options.find((option) => option.kind === "deny");
    const always = row.options.find((option) => option.kind === "allowAlways");
    const rest = row.options.filter(
      (option) =>
        option !== allowOnce &&
        option !== deny &&
        option !== always &&
        option.optionId !== row.fullAccess?.optionId,
    );
    return {
      primary: allowOnce ?? row.options[0],
      secondary: deny ?? row.options[1],
      allowAlways: always,
      extras: rest,
    };
  }, [row]);

  const respond = async (optionId: string) => {
    if (busy) return;
    setBusy(optionId);
    setError(null);
    try {
      await onRespond(row.interactionId, { optionId });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <CardShell tone="attention" icon="shield" title={approvalTitle(row.toolName)}>
      {row.summary ? (
        <Text style={[styles.summary, { color: th.inkSub }]}>{row.summary}</Text>
      ) : null}
      {row.detail ? (
        <View style={[styles.well, { backgroundColor: th.panel, borderColor: th.hairline }]}>
          <Text style={[styles.wellText, { color: th.ink }]} numberOfLines={4}>
            {row.detail}
          </Text>
        </View>
      ) : null}
      {row.autoResolution ? (
        <Text style={[styles.hint, { color: th.inkGhost }]}>超时未答会自动处理</Text>
      ) : null}
      <View style={styles.actions}>
        <View style={styles.actionCell}>
          <ActionButton
            label={secondary?.label ?? "拒绝"}
            kind="secondary"
            busy={busy === (secondary?.optionId ?? "deny")}
            disabled={busy !== null}
            onPress={() => void respond(secondary?.optionId ?? "deny")}
          />
        </View>
        <View style={styles.actionCell}>
          <ActionButton
            label={primary?.label ?? "允许本次"}
            kind="primary"
            busy={busy === (primary?.optionId ?? "allowOnce")}
            disabled={busy !== null}
            onPress={() => void respond(primary?.optionId ?? "allowOnce")}
          />
        </View>
      </View>
      {allowAlways ? (
        <ActionButton
          label={allowAlways.label}
          kind="text"
          busy={busy === allowAlways.optionId}
          disabled={busy !== null}
          onPress={() => void respond(allowAlways.optionId)}
        />
      ) : null}
      {row.fullAccess ? (
        <ActionButton
          label={row.fullAccess.label}
          kind="text"
          busy={busy === row.fullAccess.optionId}
          disabled={busy !== null}
          onPress={() => void respond(row.fullAccess!.optionId)}
        />
      ) : null}
      {extras.map((option) => (
        <ActionButton
          key={option.optionId}
          label={option.label}
          kind="text"
          busy={busy === option.optionId}
          disabled={busy !== null}
          onPress={() => void respond(option.optionId)}
        />
      ))}
      {error ? <Text style={[styles.error, { color: th.red }]}>{error}</Text> : null}
    </CardShell>
  );
}

export function QuestionCard({
  row,
  onRespond,
}: {
  row: QuestionRow;
  onRespond: InteractionResponder;
}) {
  const th = useNibiTheme();
  const questions = row.questions ?? [];
  const [picked, setPicked] = useState<Set<number>[]>(() => questions.map(() => new Set()));
  const [texts, setTexts] = useState<string[]>(() => questions.map(() => ""));
  const [single, setSingle] = useState<string | null>(null);
  const [legacyText, setLegacyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = useMemo(() => {
    if (questions.length > 0) {
      return questions.every(
        (_, index) => (picked[index]?.size ?? 0) > 0 || (texts[index] ?? "").trim().length > 0,
      );
    }
    return single !== null || legacyText.trim().length > 0;
  }, [questions, picked, texts, single, legacyText]);

  const toggle = (questionIndex: number, optionIndex: number, multi: boolean) => {
    setPicked((current) => {
      const next = current.map((set) => new Set(set));
      const target = next[questionIndex] ?? new Set<number>();
      if (multi) {
        if (target.has(optionIndex)) target.delete(optionIndex);
        else target.add(optionIndex);
      } else {
        target.clear();
        target.add(optionIndex);
      }
      next[questionIndex] = target;
      return next;
    });
  };

  const submit = async () => {
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (questions.length > 0) {
        const answers: Record<string, string> = {};
        for (let index = 0; index < questions.length; index += 1) {
          const question = questions[index]!;
          const selected = [...(picked[index] ?? new Set<number>())].map(
            (optionIndex) => question.options[optionIndex]?.label ?? "",
          );
          const custom = (texts[index] ?? "").trim();
          const parts = [...selected.filter((label) => label.length > 0)];
          if (custom.length > 0) parts.push(custom);
          answers[question.question] = parts.join(", ");
        }
        await onRespond(row.interactionId, { action: "accept", content: { answers } });
      } else {
        // 内核的 content.answer 是回答文本，不是 optionId。
        const chosen = row.options?.find((option) => option.optionId === single);
        const answer = chosen?.label ?? legacyText.trim();
        await onRespond(row.interactionId, { action: "accept", content: { answer } });
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRespond(row.interactionId, { action: "decline" });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const title = questions.length > 1 ? `${questions.length} 个问题` : "需要你的回答";

  return (
    <CardShell tone="ask" icon="question" title={title}>
      {questions.length > 0 ? (
        questions.map((question, index) => (
          <View key={`${question.header}-${index}`} style={styles.questionBlock}>
            {question.header ? (
              <Text style={[styles.questionHeader, { color: th.inkFaint }]}>{question.header}</Text>
            ) : null}
            <Text style={[styles.questionText, { color: th.ink }]}>{question.question}</Text>
            {question.options.map((option, optionIndex) => {
              const active = picked[index]?.has(optionIndex) ?? false;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => toggle(index, optionIndex, question.multiSelect)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  style={[
                    styles.option,
                    {
                      borderColor: active ? th.steel : th.hairline,
                      backgroundColor: active ? th.steelSoft : "transparent",
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.indicator,
                      question.multiSelect ? styles.indicatorSquare : styles.indicatorRound,
                      { borderColor: active ? th.steel : th.inkGhost },
                    ]}
                  >
                    {active ? <View style={[styles.indicatorDot, { backgroundColor: th.steel }]} /> : null}
                  </View>
                  <View style={styles.optionBody}>
                    <Text style={[styles.optionLabel, { color: th.ink }]}>{option.label}</Text>
                    {option.description ? (
                      <Text style={[styles.optionHint, { color: th.inkFaint }]}>
                        {option.description}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
            {row.freeText ? (
              <TextInput
                value={texts[index] ?? ""}
                onChangeText={(text) =>
                  setTexts((current) => {
                    const next = [...current];
                    next[index] = text;
                    return next;
                  })
                }
                placeholder={question.options.length > 0 ? "其他回答…" : "输入回答…"}
                placeholderTextColor={th.inkGhost}
                secureTextEntry={row.sensitive}
                multiline
                style={[
                  styles.input,
                  { color: th.ink, borderColor: th.hairline, backgroundColor: th.panel },
                ]}
              />
            ) : null}
          </View>
        ))
      ) : (
        <View style={styles.questionBlock}>
          <Text style={[styles.questionText, { color: th.ink }]}>{row.prompt}</Text>
          {row.options?.map((option) => {
            const active = single === option.optionId;
            return (
              <Pressable
                key={option.optionId}
                onPress={() => setSingle(option.optionId)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[
                  styles.option,
                  {
                    borderColor: active ? th.steel : th.hairline,
                    backgroundColor: active ? th.steelSoft : "transparent",
                  },
                ]}
              >
                <View style={[styles.indicator, styles.indicatorRound, { borderColor: active ? th.steel : th.inkGhost }]}>
                  {active ? <View style={[styles.indicatorDot, { backgroundColor: th.steel }]} /> : null}
                </View>
                <Text style={[styles.optionLabel, { color: th.ink }]}>{option.label}</Text>
              </Pressable>
            );
          })}
          {row.freeText ? (
            <TextInput
              value={legacyText}
              onChangeText={setLegacyText}
              placeholder="输入回答…"
              placeholderTextColor={th.inkGhost}
              secureTextEntry={row.sensitive}
              multiline
              style={[
                styles.input,
                { color: th.ink, borderColor: th.hairline, backgroundColor: th.panel },
              ]}
            />
          ) : null}
        </View>
      )}
      {row.autoResolution ? (
        <Text style={[styles.hint, { color: th.inkGhost }]}>超时未答会自动处理</Text>
      ) : null}
      <View style={styles.actions}>
        <View style={styles.actionCell}>
          <ActionButton
            label="不回答"
            kind="secondary"
            busy={false}
            disabled={busy}
            onPress={() => void decline()}
          />
        </View>
        <View style={styles.actionCell}>
          <ActionButton
            label="提交"
            kind="primary"
            busy={busy}
            disabled={!complete || busy}
            onPress={() => void submit()}
          />
        </View>
      </View>
      {error ? <Text style={[styles.error, { color: th.red }]}>{error}</Text> : null}
    </CardShell>
  );
}

export function InteractionCard({
  row,
  onRespond,
}: {
  row: ApprovalRow | QuestionRow;
  onRespond: InteractionResponder;
}) {
  return row.kind === "approval" ? (
    <ApprovalCard row={row} onRespond={onRespond} />
  ) : (
    <QuestionCard row={row} onRespond={onRespond} />
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  accent: { width: 3 },
  cardBody: { flex: 1, padding: space(3), gap: space(2) },
  head: { flexDirection: "row", alignItems: "center", gap: space(2) },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: t.heading, fontWeight: "600", flexShrink: 1 },
  summary: { fontSize: t.small, lineHeight: 18 },
  well: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
  },
  wellText: { fontFamily: "monospace", fontSize: t.small, lineHeight: 18 },
  hint: { fontSize: t.micro },
  actions: { flexDirection: "row", gap: space(3), marginTop: space(1) },
  actionCell: { flex: 1 },
  action: {
    minHeight: 42,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space(3),
  },
  actionLabel: { fontSize: t.body, fontWeight: "600" },
  textButton: { minHeight: 36, alignItems: "center", justifyContent: "center" },
  textButtonLabel: { fontSize: t.small },
  questionBlock: { gap: space(2) },
  questionHeader: { fontSize: t.micro, textTransform: "uppercase", letterSpacing: 0.4 },
  questionText: { fontSize: t.body, lineHeight: 20 },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
  },
  indicator: {
    width: 16,
    height: 16,
    borderWidth: 1.4,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  indicatorRound: { borderRadius: 8 },
  indicatorSquare: { borderRadius: 4 },
  indicatorDot: { width: 8, height: 8, borderRadius: 4 },
  optionBody: { flex: 1, gap: 2 },
  optionLabel: { fontSize: t.body, lineHeight: 19 },
  optionHint: { fontSize: t.micro, lineHeight: 15 },
  input: {
    minHeight: 44,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
    fontSize: t.body,
    textAlignVertical: "top",
  },
  error: { fontSize: t.small },
});
