import { useSyncExternalStore } from "react";

import type { RelaySession } from "./session";

/** 订阅聊天接线状态 + 消息树快照（ConversationStore）。 */
export function useChat(session: RelaySession) {
  const chatSnapshot = useSyncExternalStore(
    session.chat.subscribe,
    session.chat.getSnapshot,
  );
  const conversation = useSyncExternalStore(
    session.chat.store.subscribe,
    () => session.chat.store.snapshot,
  );
  return { chatSnapshot, conversation };
}
