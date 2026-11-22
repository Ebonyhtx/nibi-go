// 手机工具审批的悬浮层路由。
//
// build 模式的审批卡在应用内出现时会把 NIBI-GO 拉回前台，随后手机工具读到的是
// App 自己而不是目标应用。这里把 `mcp__phone__*` 的审批改走原生悬浮卡：
// - 有「显示在其他应用上层」权限时：悬浮卡不抢焦点，目标应用保持前台；
// - 没有权限或悬浮卡显示失败时：保留应用内审批卡（旧行为）。

import type { ChatRow } from "@nibi-go/kernel-session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  canShowPhoneApproval,
  hidePhoneApproval,
  onPhoneApproval,
  showPhoneApproval,
} from "nibi-phone";

import type { ApprovalRow, InteractionResponder } from "../components/InteractionCards";

export function isPhoneApproval(row: ChatRow): row is ApprovalRow {
  return row.kind === "approval" && row.toolName.startsWith("mcp__phone__");
}

function optionFor(row: ApprovalRow, preferred: string, fallbackIndex: number): string | null {
  const match = row.options.find((option) => option.optionId === preferred);
  if (match) return match.optionId;
  return row.options[fallbackIndex]?.optionId ?? null;
}

export function usePhoneApprovalOverlay(
  rows: readonly ChatRow[],
  onRespond: InteractionResponder,
): { isOverlayApproval: (row: ChatRow) => boolean } {
  const [overlayIds, setOverlayIds] = useState<ReadonlySet<string>>(() => new Set());
  const responderRef = useRef(onRespond);
  useEffect(() => {
    responderRef.current = onRespond;
  }, [onRespond]);

  const pending = useMemo(() => rows.find(isPhoneApproval) ?? null, [rows]);
  const pendingId = pending?.interactionId ?? null;
  // 只有真的存在手机审批行时才查原生悬浮窗权限，避免流式期间每帧打 JNI。
  const canOverlay = pending ? canShowPhoneApproval() : false;

  // 悬浮卡上的选择回到内核；先收起卡片，应答失败时应用内卡片会重新出现。
  useEffect(
    () =>
      onPhoneApproval(({ interactionId, optionId }) => {
        hidePhoneApproval(interactionId);
        setOverlayIds((current) => {
          const next = new Set(current);
          next.delete(interactionId);
          return next;
        });
        void responderRef.current(interactionId, { optionId });
      }),
    [],
  );

  useEffect(() => {
    if (!pending || !canOverlay) return;
    const allowOptionId = optionFor(pending, "allowOnce", 0);
    const denyOptionId = optionFor(pending, "deny", 1);
    if (!allowOptionId || !denyOptionId) return;
    // 内核 allowAlways：按工具记住规则（本项目内不再逐次询问同一工具）。
    const alwaysOptionId =
      pending.options.find((option) => option.kind === "allowAlways")?.optionId ?? null;
    const interactionId = pending.interactionId;
    let cancelled = false;

    void showPhoneApproval({
      interactionId,
      toolName: pending.toolName,
      summary: pending.summary,
      detail: pending.detail ?? "",
      allowOptionId,
      alwaysOptionId,
      denyOptionId,
    }).then((shown) => {
      if (cancelled) {
        if (shown) hidePhoneApproval(interactionId);
        return;
      }
      if (!shown) return;
      setOverlayIds((current) => {
        const next = new Set(current);
        next.add(interactionId);
        return next;
      });
    });

    return () => {
      cancelled = true;
      hidePhoneApproval(interactionId);
      setOverlayIds((current) => {
        const next = new Set(current);
        next.delete(interactionId);
        return next;
      });
    };
  }, [pendingId, canOverlay]);

  const isOverlayApproval = useCallback(
    (row: ChatRow): boolean =>
      row.kind === "approval" && overlayIds.has(row.interactionId),
    [overlayIds],
  );

  return { isOverlayApproval };
}