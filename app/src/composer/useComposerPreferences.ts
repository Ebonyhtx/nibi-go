import { useEffect, useState } from "react";

import type { ComposerCatalogItem } from "./catalog";
import {
  getCachedComposerPreferences,
  loadComposerPreferences,
  subscribeComposerPreferences,
  type ComposerPreferences,
} from "./preferences";

export function useComposerPreferences(
  catalog: readonly ComposerCatalogItem[],
): ComposerPreferences | null {
  const [preferences, setPreferences] = useState<ComposerPreferences | null>(
    getCachedComposerPreferences,
  );

  useEffect(() => {
    let active = true;
    void loadComposerPreferences(catalog).then((next) => {
      if (active) setPreferences(next);
    });
    const unsubscribe = subscribeComposerPreferences((next) => {
      if (active) setPreferences(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [catalog]);

  return preferences;
}