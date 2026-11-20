import { useCallback, useEffect, useState } from "react";

import {
  getCachedMemoryPreferences,
  loadMemoryPreferences,
  MEMORY_DEFAULTS,
  saveMemoryPreferences,
  subscribeMemoryPreferences,
  type MemoryPreferences,
} from "./preferences";

export interface MemoryPreferencesState {
  preferences: MemoryPreferences;
  setEnabled: (enabled: boolean) => void;
}

export function useMemoryPreferences(): MemoryPreferencesState {
  const [preferences, setPreferences] = useState<MemoryPreferences>(() => {
    const current = getCachedMemoryPreferences();
    return current ?? { ...MEMORY_DEFAULTS };
  });

  useEffect(() => {
    let active = true;
    void loadMemoryPreferences().then((next) => {
      if (active) setPreferences(next);
    });
    const unsubscribe = subscribeMemoryPreferences((next) => {
      if (active) setPreferences(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      const next: MemoryPreferences = { version: 1, enabled };
      setPreferences(next);
      void saveMemoryPreferences(next);
    },
    [],
  );

  return { preferences, setEnabled };
}
