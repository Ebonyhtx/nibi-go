// NIBI-GO Phase C：进程内内核（libnibi.so）的 JS 绑定。
//
// 内核本体不随 App 源码入库：构建期 `scripts/android-kernel/fetch.mjs` 从
// `@nibi-studio/cli-android-arm64` 取 `lib/libnibi.so` + `lib/libc++_shared.so`，
// 按 `build.json.artifacts` 校验 sha256 后落到 android/prebuilt/jniLibs/（gitignore）。
//
// 可用性：只有 arm64-v8a 产物。x86_64 模拟器 / Expo Go 里没有这个原生模块或加载失败，
// 所有入口都静默降级（返回 null/false），不炸 import —— 与 nibi-keepalive 同一套写法。
import { requireNativeModule } from "expo-modules-core";

type KernelLineEvent = { line: string };
type KernelErrorEvent = { message: string };

interface NibiKernelHostNativeModule {
  isAvailable(): boolean;
  loadError(): string | null;
  abiVersion(): number;
  start(): Promise<boolean>;
  send(line: string): boolean;
  stop(): boolean;
  destroy(): void;
  addListener(
    event: "onKernelLine",
    listener: (payload: KernelLineEvent) => void,
  ): { remove(): void };
  addListener(
    event: "onKernelError",
    listener: (payload: KernelErrorEvent) => void,
  ): { remove(): void };
}

let native: NibiKernelHostNativeModule | null = null;
let unavailable = false;

function getNative(): NibiKernelHostNativeModule | null {
  if (native) return native;
  if (unavailable) return null;
  try {
    native = requireNativeModule<NibiKernelHostNativeModule>("NibiKernelHost");
    return native;
  } catch {
    unavailable = true;
    return null;
  }
}

/** 内核 JNI 层是否可用（含 .so 加载成功）。 */
export function kernelHostAvailable(): boolean {
  const module = getNative();
  if (!module) return false;
  try {
    return module.isAvailable();
  } catch {
    return false;
  }
}

/** 不可用原因（模块缺失返回 null，加载失败返回原生错误）。 */
export function kernelHostLoadError(): string | null {
  const module = getNative();
  if (!module) return null;
  try {
    return module.loadError();
  } catch {
    return null;
  }
}

/** 内核 C ABI 版本；不可用时返回 -1（v1 = 1）。 */
export function kernelHostAbiVersion(): number {
  const module = getNative();
  if (!module) return -1;
  try {
    return module.abiVersion();
  } catch {
    return -1;
  }
}

/**
 * 启动内核线程。宿主必须**先**设好进程环境与 cwd（HOME / NIBI_DATA_BASE_DIR /
 * NIBI_SESSION_DB_PATH …），内核在 start 时只读一次。
 */
export async function startKernelHost(): Promise<boolean> {
  const module = getNative();
  if (!module) return false;
  try {
    return await module.start();
  } catch {
    return false;
  }
}

/** 送入一行 Host → kernel 帧（缺 LF 由内核补）；返回是否入队成功。 */
export function sendKernelLine(line: string): boolean {
  const module = getNative();
  if (!module) return false;
  try {
    return module.send(line);
  } catch {
    return false;
  }
}

/** 取消内核循环；destroy 会等待线程退出。 */
export function stopKernelHost(): boolean {
  const module = getNative();
  if (!module) return false;
  try {
    return module.stop();
  } catch {
    return false;
  }
}

/** 停止并释放句柄（可重复调用）。 */
export function destroyKernelHost(): void {
  const module = getNative();
  if (!module) return;
  try {
    module.destroy();
  } catch {
    // 已释放/不可用：忽略。
  }
}

/** 订阅内核输出行（已按 LF 切帧的完整 JSON 行）。返回取消函数。 */
export function onKernelLine(listener: (line: string) => void): () => void {
  const module = getNative();
  if (!module) return () => {};
  const subscription = module.addListener("onKernelLine", (event) => listener(event.line));
  return () => subscription.remove();
}

/** 订阅内核异步错误。返回取消函数。 */
export function onKernelError(listener: (message: string) => void): () => void {
  const module = getNative();
  if (!module) return () => {};
  const subscription = module.addListener("onKernelError", (event) => listener(event.message));
  return () => subscription.remove();
}
