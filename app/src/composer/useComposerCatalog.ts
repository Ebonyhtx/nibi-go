// 设置页/首页共用的 COMPOSE 目录：插件（含停用，供“启停状态”展示）+ 本机/插件技能。
//
// 首页用 useKernelConversation 已有的 client 拿会话技能；设置页没有活动会话，
// 这里启动同一个内核（幂等）按 workspace authority 扫一次，并补插件清单里的技能。

import { Paths } from "expo-file-system";
import { useEffect, useMemo, useState } from "react";

import { KernelSessionClient, type KernelSkillReference } from "@nibi-go/kernel-session";
import {
  kernelHostAvailable,
  onKernelLine,
  sendKernelLine,
  startKernelHost,
} from "nibi-kernel-host";

import { useLocale } from "../i18n";
import { loadPlugins, type LoadedPlugin } from "../plugins/store";
import {
  buildComposerCatalog,
  mergeSkillCatalog,
  type ComposerCatalogItem,
} from "./catalog";

function workspaceRef(): { workspacePath: string; workspaceKey: string } {
  const workspacePath = Paths.document.uri.replace(/^file:\/\//u, "");
  return { workspacePath, workspaceKey: workspacePath };
}

export function useComposerCatalog(): {
  catalog: ComposerCatalogItem[];
  plugins: LoadedPlugin[];
  loading: boolean;
} {
  const locale = useLocale();
  const [plugins, setPlugins] = useState<LoadedPlugin[]>([]);
  const [skills, setSkills] = useState<readonly KernelSkillReference[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadPlugins()
      .then((loaded) => {
        if (!cancelled) setPlugins(loaded);
      })
      .catch(() => {
        if (!cancelled) setPlugins([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let client: KernelSessionClient | null = null;
    void (async () => {
      try {
        const started =
          (await startKernelHost(undefined, { useService: true })) ||
          (await startKernelHost(undefined, { useService: false }));
        if (!started || cancelled || !kernelHostAvailable()) return;
        client = new KernelSessionClient({
          transport: { sendLine: sendKernelLine, onLine: onKernelLine },
        });
        const result = await client.request<{ skills?: KernelSkillReference[] }>(
          "skills/referenceCatalog",
          { workspace: workspaceRef() },
        );
        if (!cancelled && Array.isArray(result.skills)) setSkills(result.skills);
      } catch {
        if (!cancelled) setSkills([]);
      }
    })();
    return () => {
      cancelled = true;
      client?.close();
    };
  }, []);

  const catalog = useMemo(
    () => buildComposerCatalog(plugins, mergeSkillCatalog(skills, plugins)),
    [locale, plugins, skills],
  );

  return { catalog, plugins, loading };
}