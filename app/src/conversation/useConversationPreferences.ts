import { useCallback, useEffect, useState } from "react";

import {
  CONVERSATION_DEFAULTS,
  getCachedConversationPreferences,
  loadConversationPreferences,
  saveConversationPreferences,
  subscribeConversationPreferences,
  type ConversationPreferenceKey,
  type ConversationPreferences,
} from "./preferences";

export interface ConversationPreferencesState {
  preferences: ConversationPreferences;
  /** 乐观更新：先改内存与 UI，再异步落盘（失败只记日志）。 */
  setPreference: (key: ConversationPreferenceKey, value: boolean) => void;
}

export function useConversationPreferences(): ConversationPreferencesState {
  const [preferences, setPreferences] = useState<ConversationPreferences>(
    () => getCachedConversationPreferences() ?? { ...CONVERSATION_DEFAULTS },
  );

  useEffect(() => {
    let active = true;
    void loadConversationPreferences().then((next) => {
      if (active) setPreferences(next);
    });
    const unsubscribe = subscribeConversationPreferences((next) => {
      if (active) setPreferences(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const setPreference = useCallback(
    (key: ConversationPreferenceKey, value: boolean) => {
      const next: ConversationPreferences = { ...preferences, [key]: value };
      setPreferences(next);
      void saveConversationPreferences(next);
    },
    [preferences],
  );

  return { preferences, setPreference };
}