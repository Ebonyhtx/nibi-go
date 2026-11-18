// 内核启动时的开发期模型环境。
//
// 默认 dev 用本机 mock（scripts/dev/mock-openai.mjs + adb reverse 9099）；
// 两种情况下不注入：
//   1. `EXPO_PUBLIC_NIBI_REAL_PROVIDER=1`（显式要真 Provider）；
//   2. 设置页已经配了 personal Provider —— dev 缺省 mock 会静默顶掉真实端点（曾让
//      deepseek-flash 打到 127.0.0.1:9099，全部请求 network error，而界面只显示一句
//      “network error”）。开发便利不能压过用户配置。
import { File, Paths } from "expo-file-system";

const DEV_MOCK_ENV: Record<string, string> = {
  NIBI_MODEL_BASE_URL: "http://127.0.0.1:9099/v1",
  NIBI_API_KEY: "mock-key",
  NIBI_MODEL: "mock-model",
};

/** 设置页写的那份配置里是否有 personal Provider（key 在 Keystore，不在文件里）。 */
async function hasPersonalProvider(): Promise<boolean> {
  try {
    const file = new File(Paths.document, ".nibi/v2/provider_config.json");
    if (!file.exists) return false;
    const parsed = JSON.parse(await file.text()) as {
      config?: { providerConfigRules?: { providerRules?: { providerId?: unknown }[] } };
    };
    const rules = parsed?.config?.providerConfigRules?.providerRules ?? [];
    return rules.some(
      (rule) => typeof rule.providerId === "string" && rule.providerId.startsWith("personal:"),
    );
  } catch {
    // 读不出来就按“没配”处理：仍是 dev mock 的旧行为，但不阻塞启动。
    return false;
  }
}

export async function kernelStartEnv(): Promise<Record<string, string> | undefined> {
  if (!__DEV__) return undefined;
  if (process.env.EXPO_PUBLIC_NIBI_REAL_PROVIDER === "1") return undefined;
  if (await hasPersonalProvider()) return undefined;
  return DEV_MOCK_ENV;
}