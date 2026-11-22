// 审批 / 提问卡片（对齐 dsh-Go ApprovalCard + QuestionCard）：
// 卡片里是光标（警示色细边 + 盾牌），正文给命令/路径，底部两键；
// 「本对话都允许」降级成文字按钮，避免误触。
//
// 数据来自内核 V4 快照的 `pendingInteractions`（行模型见 kernel-session rows.ts），
// 回答走 `v4/command` 的 `resolveInteraction`；答完内核把它从快照移除，卡片随下一帧消失。
import type { ChatRow } from "@nibi-go/kernel-session";
import { type ReactNode, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { haptic } from "../motion/haptics";
import { PressableScale } from "../motion/PressableScale";
import { radius, size, space, text, useNibiTheme } from "../theme";
import { Icon } from "./Icon";
import { PillButton } from "./ui/PillButton";

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
  badge,
  children,
}: {
  tone: "attention" | "ask";
  icon: "shield" | "question";
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  const th = useNibiTheme();
  const accent = tone === "attention" ? th.amber : th.steel;
  const soft = tone === "attention" ? th.amberSoft : th.steelSoft;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: th.card, borderColor: th.hairlineStrong },
        th.elevation.card,
      ]}
    >
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.cardBody}>
        <View style={styles.head}>
          <View style={[styles.iconWrap, { backgroundColor: soft, borderColor: th.hairline }]}>
            <Icon name={icon} size={15} color={accent} />
          </View>
          <Text style={[styles.title, { color: th.ink }]}>{title}</Text>
          {badge ? (
            <View
              style={[
                styles.headBadge,
                { backgroundColor: soft, borderColor: th.hairline },
              ]}
            >
              <Text style={[styles.headBadgeText, { color: accent }]} numberOfLines={1}>
                {badge}
              </Text>
            </View>
          ) : null}
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
  kind: "primary" | "secondary" | "danger" | "text";
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const th = useNibiTheme();
  if (kind === "text") {
    // 「本对话都允许」这类三级动作：透明药丸 + PressableScale，不与主键抢视觉。
    return (
      <PressableScale
        onPress={onPress}
        disabled={disabled}
        scaleTo={0.96}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={styles.textButton}
      >
        <Text style={[styles.textButtonLabel, { color: disabled ? th.inkGhost : th.inkSub }]}>
          {busy ? "处理中…" : label}
        </Text>
      </PressableScale>
    );
  }
  // 主/次键统一走 PillButton（按压回弹内建、高度走 size 阶梯）：
  // 允许=primary（品牌底），拒绝=danger（红），其余次要键=secondary（面板底+发丝线）。
  return (
    <PillButton
      label={busy ? "处理中…" : label}
      variant={kind === "primary" ? "primary" : kind === "danger" ? "danger" : "secondary"}
      buttonSize="md"
      onPress={onPress}
      disabled={disabled}
      style={styles.actionFill}
    />
  );
}

/** 自由作答输入井（2.0 规范）：th.card 实色底、默认发丝线，聚焦加深一档（hairlineStrong）。 */
function AnswerInput({
  value,
  onChangeText,
  placeholder,
  sensitive,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  sensitive?: boolean;
}) {
  const th = useNibiTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={th.inkGhost}
      secureTextEntry={sensitive}
      multiline
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.input,
        {
          color: th.ink,
          backgroundColor: th.card,
          borderColor: focused ? th.hairlineStrong : th.hairline,
        },
      ]}
    />
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
    haptic(optionId === "deny" ? "reject" : "confirm");
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
    <CardShell
      tone="attention"
      icon="shield"
      title={approvalTitle(row.toolName)}
      badge={row.toolName || undefined}
    >
      {row.summary ? (
        <Text style={[styles.summary, { color: th.inkSub }]}>{row.summary}</Text>
      ) : null}
      {row.detail ? (
        // 命令井：比卡片更深一档的次级面（panel）+ control 圆角 + 等宽字，路径与命令一眼可辨。
        <View
          style={[
            styles.well,
            { backgroundColor: th.panel, borderColor: th.hairlineStrong },
          ]}
        >
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
          {/* 拒绝键给 danger（红）而不是普通次键：误触代价不对称，色先挡一道。 */}
          <ActionButton
            label={secondary?.label ?? "拒绝"}
            kind="danger"
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
      {allowAlways || row.fullAccess || extras.length > 0 ? (
        <View style={[styles.extraActions, { borderTopColor: th.hairline }]}>
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
        </View>
      ) : null}
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
    <CardShell
      tone="ask"
      icon="question"
      title={title}
      badge={questions.length > 1 ? `${questions.length} 项` : undefined}
    >
      {questions.length > 0 ? (
        questions.map((question, index) => (
          <View key={`${question.header}-${index}`} style={styles.questionBlock}>
            {question.header ? (
              <View
                style={[
                  styles.questionHeaderPill,
                  { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
                ]}
              >
                <Text style={[styles.questionHeader, { color: th.inkSub }]}>
                  {question.header}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.questionText, { color: th.ink }]}>{question.question}</Text>
            {question.options.map((option, optionIndex) => {
              const active = picked[index]?.has(optionIndex) ?? false;
              return (
                <PressableScale
                  key={option.value}
                  onPress={() => toggle(index, optionIndex, question.multiSelect)}
                  scaleTo={0.98}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      borderColor: active ? th.steel : th.hairline,
                      backgroundColor: active
                        ? th.steelSoft
                        : pressed
                          ? th.hover
                          : th.surfaceSoft,
                    },
                  ]}
                >
                  {/* radio/checkbox 统一 16px 圆圈（radius.xs 正好半宽）：语义靠内点/勾区分。 */}
                  <View style={[styles.indicator, { borderColor: active ? th.steel : th.inkGhost }]}>
                    {active ? (
                      question.multiSelect ? (
                        <Icon name="check" size={10} color={th.steel} />
                      ) : (
                        <View style={[styles.indicatorDot, { backgroundColor: th.steel }]} />
                      )
                    ) : null}
                  </View>
                  <View style={styles.optionBody}>
                    <Text style={[styles.optionLabel, { color: th.ink }]}>{option.label}</Text>
                    {option.description ? (
                      <Text style={[styles.optionHint, { color: th.inkFaint }]}>
                        {option.description}
                      </Text>
                    ) : null}
                  </View>
                </PressableScale>
              );
            })}
            {row.freeText ? (
              <AnswerInput
                value={texts[index] ?? ""}
                onChangeText={(value) =>
                  setTexts((current) => {
                    const next = [...current];
                    next[index] = value;
                    return next;
                  })
                }
                placeholder={question.options.length > 0 ? "其他回答…" : "输入回答…"}
                sensitive={row.sensitive}
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
              <PressableScale
                key={option.optionId}
                onPress={() => setSingle(option.optionId)}
                scaleTo={0.98}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    borderColor: active ? th.steel : th.hairline,
                    backgroundColor: active
                      ? th.steelSoft
                      : pressed
                        ? th.hover
                        : th.surfaceSoft,
                  },
                ]}
              >
                <View style={[styles.indicator, { borderColor: active ? th.steel : th.inkGhost }]}>
                  {active ? <View style={[styles.indicatorDot, { backgroundColor: th.steel }]} /> : null}
                </View>
                <Text style={[styles.optionLabel, { color: th.ink }]}>{option.label}</Text>
              </PressableScale>
            );
          })}
          {row.freeText ? (
            <AnswerInput
              value={legacyText}
              onChangeText={setLegacyText}
              placeholder="输入回答…"
              sensitive={row.sensitive}
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
            onPress={() => {
              haptic("reject");
              void decline();
            }}
          />
        </View>
        <View style={styles.actionCell}>
          <ActionButton
            label="提交"
            kind="primary"
            busy={busy}
            disabled={!complete || busy}
            onPress={() => {
              haptic("confirm");
              void submit();
            }}
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
  cardBody: {
    flex: 1,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    gap: space(2.5),
  },
  head: { flexDirection: "row", alignItems: "center", gap: space(2) },
  iconWrap: {
    width: size.chip,
    height: size.chip,
    borderRadius: radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...text("heading"), fontWeight: "700", flex: 1 },
  headBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: 2,
    maxWidth: 120,
  },
  headBadgeText: { ...text("micro"), fontWeight: "700" },
  summary: { ...text("small") },
  // 命令井：次级面（panel）+ control 圆角，和卡片面拉开一档「待执行内容」的层级。
  well: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
  },
  wellText: { fontFamily: "monospace", ...text("small"), lineHeight: 19 },
  hint: { ...text("micro") },
  actions: { flexDirection: "row", gap: space(2.5), marginTop: space(1) },
  actionCell: { flex: 1 },
  // PillButton 铺满所在格：两键等宽；高度由 md 档（size.button）接管，不再写 minHeight 42。
  actionFill: { width: "100%" },
  extraActions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(1.5),
    gap: space(0.5),
  },
  textButton: {
    minHeight: size.chipLg,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    alignItems: "center",
    justifyContent: "center",
  },
  textButtonLabel: { ...text("small"), fontWeight: "600" },
  questionBlock: { gap: space(2) },
  questionHeaderPill: {
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xs,
    paddingHorizontal: space(2),
    paddingVertical: 2,
  },
  questionHeader: {
    ...text("micro"),
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  questionText: { ...text("body"), fontWeight: "600" },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
  },
  // 16px 圆圈：radius.xs(8) 正好是半宽。radio/checkbox 同一几何，语义靠内点/勾区分；
  // 描边 1.4 是 16px 件上 2px 网格笔画的光学等效（theme 还没有描边 token）。
  indicator: {
    width: 16,
    height: 16,
    borderWidth: 1.4,
    borderRadius: radius.xs,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  indicatorDot: { width: 8, height: 8, borderRadius: radius.xs },
  optionBody: { flex: 1, gap: 2 },
  optionLabel: { ...text("body"), fontWeight: "500" },
  optionHint: { ...text("micro") },
  input: {
    minHeight: size.buttonLg,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    ...text("body"),
    textAlignVertical: "top",
  },
  error: { ...text("small") },
});
