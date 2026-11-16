// Provider 设置页的内核 RPC（`provider/*`）：列表/预设、保存、删除、设默认、连通性测试。
//
// 配置写 `~/.nibi/v2/provider_config.json`（与桌面/CLI 同一份）；API key 不在这条链路里，
// 由 `providerKeys.ts` 存 Keystore，再经 `provider/setKeys` 送进内核内存。
import { Paths } from "expo-file-system";

export type ProviderProtocol =
  | "anthropic-messages"
  | "openai-chat-completions"
  | "openai-responses";

export interface ProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  protocol?: ProviderProtocol;
  models: string[];
  hasKey: boolean;
  account: boolean;
  personal: boolean;
  enabled: boolean;
  template?: string;
  defaultReasoning?: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  models: string[];
}

export interface ModelSelection {
  providerId: string;
  modelId: string;
  reasoningLevel?: string;
}

export interface ProviderState {
  providers: ProviderSummary[];
  presets: ProviderPreset[];
  default?: ModelSelection;
}

export interface ProviderDraft {
  providerId?: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  models: string[];
  template?: string;
  enabled?: boolean;
}

interface KernelRpc {
  request<T = unknown>(method: string, params: unknown): Promise<T>;
}

export const PROVIDER_PROTOCOLS: { value: ProviderProtocol; label: string }[] = [
  { value: "openai-chat-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
];

export function workspaceRef(): { workspacePath: string; workspaceKey: string } {
  const workspacePath = Paths.document.uri.replace(/^file:\/\//u, "");
  return { workspacePath, workspaceKey: workspacePath };
}

export async function fetchProviderState(client: KernelRpc): Promise<ProviderState> {
  const state = await client.request<ProviderState & { default?: unknown }>("provider/state", {});
  // 内核的 `ModelSelection` 序列化字段是 provider/model/reasoning（不是 providerId/modelId），
  // 这里统一成 UI 用的名字；两种形状都收，避免内核升级时再改一次。
  const raw =
    state?.default && typeof state.default === "object"
      ? (state.default as unknown as Record<string, unknown>)
      : undefined;
  const providerId = typeof raw?.providerId === "string" ? raw.providerId : raw?.provider;
  const modelId = typeof raw?.modelId === "string" ? raw.modelId : raw?.model;
  const reasoningLevel =
    typeof raw?.reasoningLevel === "string" ? raw.reasoningLevel : raw?.reasoning;
  return {
    providers: Array.isArray(state?.providers) ? state.providers : [],
    presets: Array.isArray(state?.presets) ? state.presets : [],
    default:
      typeof providerId === "string" && typeof modelId === "string"
        ? {
            providerId,
            modelId,
            ...(typeof reasoningLevel === "string" ? { reasoningLevel } : {}),
          }
        : undefined,
  };
}

export async function saveProvider(client: KernelRpc, draft: ProviderDraft): Promise<string> {
  const result = await client.request<{ providerId?: unknown }>("provider/save", {
    ...draft,
    enabled: draft.enabled ?? true,
  });
  if (typeof result?.providerId !== "string" || !result.providerId) {
    throw new Error("provider/save 没有返回 providerId");
  }
  return result.providerId;
}

export async function removeProvider(client: KernelRpc, providerId: string): Promise<void> {
  await client.request("provider/remove", { providerId });
}

export async function setDefaultProvider(
  client: KernelRpc,
  selection: ModelSelection,
): Promise<void> {
  await client.request("provider/setDefault", { selection });
}

export async function testProvider(
  client: KernelRpc,
  selection: ModelSelection,
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.request("provider/testModelConnectivity", {
      workspace: workspaceRef(),
      selection,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}