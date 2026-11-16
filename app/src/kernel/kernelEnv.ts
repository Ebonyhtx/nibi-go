// 内核启动时的开发期模型环境。
//
// 默认 dev 用本机 mock（scripts/dev/mock-openai.mjs + adb reverse 9099）；
// `EXPO_PUBLIC_NIBI_REAL_PROVIDER=1` 时不注入，让设置页配置的真实 Provider 生效。
const DEV_MOCK_ENV: Record<string, string> = {
  NIBI_MODEL_BASE_URL: "http://127.0.0.1:9099/v1",
  NIBI_API_KEY: "mock-key",
  NIBI_MODEL: "mock-model",
};

export function kernelStartEnv(): Record<string, string> | undefined {
  if (!__DEV__) return undefined;
  if (process.env.EXPO_PUBLIC_NIBI_REAL_PROVIDER === "1") return undefined;
  return DEV_MOCK_ENV;
}